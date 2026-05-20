"""Thin Fabric Data Agent MCP wrapper backed by MAF's MCP client."""

import asyncio
import concurrent.futures
import json
import logging
import os
import threading
import time
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx
from agent_framework import MCPStreamableHTTPTool
from azure.core.exceptions import ClientAuthenticationError
from azure.identity import ClientSecretCredential, DefaultAzureCredential
from mcp import ClientSession
from mcp.shared.exceptions import McpError

from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)

FABRIC_API_SCOPE = "https://api.fabric.microsoft.com/.default"
DEFAULT_DIAGNOSTIC_PREVIEW_CHARS = 4_000
TOKEN_REFRESH_BUFFER_SECONDS = 300
_HTTP_TIMEOUT = 115.0

_token_cache: dict[str, tuple[str, float]] = {}
_token_lock = threading.Lock()
_default_credential: Optional[DefaultAzureCredential] = None


class FabricMcpError(RuntimeError):
    pass

def _truncate(text: object, max_len: int = 200) -> str:
    value = text if isinstance(text, str) else str(text)
    return value if len(value) <= max_len else value[:max_len] + f"... ({len(value)} chars total)"

def _resolve_env(env_var_name: str) -> str:
    value = os.environ.get(env_var_name, "")
    if not value:
        raise FabricMcpError(f"Required environment variable '{env_var_name}' is not set")
    return value


def _redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {key: "Bearer <redacted>" if key.lower() == "authorization" else value for key, value in headers.items()}


def _sanitize_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except ValueError:
        return _truncate(url, 300)


def _decode_jwt_claims(token: str) -> dict[str, Any]:
    import base64
    import binascii

    parts = token.split(".")
    if len(parts) < 2:
        raise ValueError("token does not have a JWT payload segment")
    try:
        decoded = base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4))
    except binascii.Error as e:
        raise ValueError(f"invalid base64 payload: {e}") from e
    data = json.loads(decoded)
    if not isinstance(data, dict):
        raise ValueError("JWT payload is not a JSON object")
    return data


def _cache_get(cache_key: str) -> str | None:
    cached = _token_cache.get(cache_key)
    if cached and cached[1] > time.time() + TOKEN_REFRESH_BUFFER_SECONDS:
        return cached[0]
    return None

def _get_token_default_credential(scope: str) -> str:
    global _default_credential
    cache_key = f"default:{scope}"
    with _token_lock:
        if token := _cache_get(cache_key):
            return token
        if _default_credential is None:
            client_id = os.environ.get("AZURE_CLIENT_ID", "")
            _default_credential = DefaultAzureCredential(managed_identity_client_id=client_id) if client_id else DefaultAzureCredential()
        token_response = _default_credential.get_token(scope)
        _token_cache[cache_key] = (token_response.token, token_response.expires_on)
        return token_response.token


def _get_token_sp(tenant_id: str, client_id: str, client_secret: str, scope: str) -> str:
    cache_key = f"sp:{tenant_id}:{client_id}:{scope}"
    with _token_lock:
        if token := _cache_get(cache_key):
            return token
        token_response = ClientSecretCredential(tenant_id, client_id, client_secret).get_token(scope)
        _token_cache[cache_key] = (token_response.token, token_response.expires_on)
        return token_response.token


def _content_item_text(item: Any) -> str:
    if isinstance(item, str):
        return item
    if isinstance(text := getattr(item, "text", None), str):
        return text
    if isinstance(item, dict) and isinstance(item.get("text"), str):
        return item["text"]
    if hasattr(item, "model_dump"):
        return json.dumps(item.model_dump(mode="json"), ensure_ascii=False)
    return "" if item is None else str(item)


def _parse_mcp_tool_result(result: Any) -> str:
    content = getattr(result, "content", None)
    if isinstance(content, list):
        parts = [text for item in content if (text := _content_item_text(item))]
        if parts:
            return "\n".join(parts)
    structured = getattr(result, "structuredContent", None) or getattr(result, "structured_content", None)
    return json.dumps(structured, default=str, ensure_ascii=False) if structured is not None else ""


async def _call_mcp_async(mcp_url: str, tool_name: str, task: str, token: str) -> str:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream"}
    logger.info("🌐 MCP endpoint        │ url=%s headers=%s", _sanitize_url(mcp_url), _redact_headers(headers))
    async with httpx.AsyncClient(headers=headers, timeout=_HTTP_TIMEOUT, follow_redirects=True) as http_client:
        mcp_tool = MCPStreamableHTTPTool(
            name="fabric_mcp",
            url=mcp_url,
            load_tools=False,
            load_prompts=False,
            http_client=http_client,
        )
        async with mcp_tool.get_mcp_client() as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments={"userQuestion": task})
                if result.isError:
                    raise FabricMcpError(_parse_mcp_tool_result(result) or f"MCP tool {tool_name} returned an error")
                return _parse_mcp_tool_result(result)


def _run_async(coro) -> str:
    with concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="fabric-mcp-call") as pool:
        return pool.submit(lambda: asyncio.run(coro)).result()


def run_fabric_mcp(
    mcp_url_env: str,
    mcp_tool_name: str,
    task: str,
    event_callback: EventCallback = None,
    source_name: str = "",
    auth_mode: str = "default_credential",
    tenant_id_env: str = "",
    client_id_env: str = "",
    client_secret_env: str = "",
    scope: str = FABRIC_API_SCOPE,
    user_token: Optional[str] = None,
) -> str:
    """Invoke a Fabric Data Agent MCP tool while preserving the existing dispatch contract."""
    t0 = time.perf_counter()
    logger.info("🚀 FABRIC MCP CALL     │ tool=%s task=%s", mcp_tool_name, _truncate(task, DEFAULT_DIAGNOSTIC_PREVIEW_CHARS))
    if event_callback:
        event_callback(AgentEvent(event_type=EventType.AGENT_STARTED, source=source_name, data={"agent_name": f"fabric-mcp:{mcp_tool_name}"}))

    try:
        mcp_url = _resolve_env(mcp_url_env)
        if user_token:
            token = user_token
        elif auth_mode == "service_principal":
            token = _get_token_sp(_resolve_env(tenant_id_env), _resolve_env(client_id_env), _resolve_env(client_secret_env), scope)
        else:
            token = _get_token_default_credential(scope)

        response_text = _run_async(_call_mcp_async(mcp_url, mcp_tool_name, task, token))
        elapsed = time.perf_counter() - t0
        logger.info("✅ MCP CALL COMPLETED  │ length=%d chars (%.1fs)", len(response_text), elapsed)
        logger.info("📥 RESPONSE PREVIEW    │ %s", _truncate(response_text, DEFAULT_DIAGNOSTIC_PREVIEW_CHARS))
        if event_callback:
            event_callback(AgentEvent(event_type=EventType.AGENT_STREAMING, source=source_name, data={"delta": response_text}))
            event_callback(AgentEvent(
                event_type=EventType.AGENT_COMPLETED,
                source=source_name,
                data={"length": len(response_text), "elapsed": elapsed, "result": response_text},
            ))
        return response_text
    except (McpError, httpx.HTTPError, ClientAuthenticationError, FabricMcpError) as e:
        elapsed = time.perf_counter() - t0
        logger.error("❌ MCP CALL FAILED     │ error=%s (%.1fs)", str(e)[:500], elapsed)
        if event_callback:
            event_callback(AgentEvent(event_type=EventType.AGENT_ERROR, source=source_name, data={"error": str(e), "elapsed": elapsed}))
        raise FabricMcpError(f"Fabric MCP call failed: {e}") from e
