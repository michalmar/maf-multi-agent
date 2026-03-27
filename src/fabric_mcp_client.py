"""Fabric Data Agent MCP client with service principal authentication.

Calls the Fabric Data Agent MCP endpoint directly via HTTP using
JSON-RPC protocol. Authenticates with ClientSecretCredential (service
principal) and caches tokens until near-expiry.

Mirrors the interface of foundry_client.run_foundry_agent() so it can
be used as a drop-in replacement in agent_loader.py and dispatcher.py.
"""

import asyncio
import concurrent.futures
import json
import logging
import os
import queue
import time
import threading
from dataclasses import dataclass
from typing import Optional

import httpx
from azure.identity import ClientSecretCredential

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)

# Shared thread pool for MCP invocations — avoids per-call ThreadPoolExecutor overhead
_mcp_pool = concurrent.futures.ThreadPoolExecutor(max_workers=10, thread_name_prefix="fabric-mcp")

FABRIC_API_SCOPE = "https://api.fabric.microsoft.com/.default"
TOKEN_REFRESH_BUFFER_SECONDS = 300  # refresh 5 minutes before expiry


class FabricMcpError(RuntimeError):
    """Raised when a Fabric MCP call fails."""


@dataclass
class _CachedToken:
    """In-memory token cache entry."""
    token: str
    expires_at: float  # time.time() based


# Module-level token cache keyed by (tenant_id, client_id, scope)
_token_cache: dict[tuple[str, str, str], _CachedToken] = {}
_token_lock = threading.Lock()
# Reusable credentials keyed by (tenant_id, client_id) — avoids connection pool leaks
_credentials: dict[tuple[str, str], ClientSecretCredential] = {}


def _get_token(tenant_id: str, client_id: str, client_secret: str, scope: str) -> str:
    """Acquire a Fabric API token, using cache when possible. Thread-safe."""
    cache_key = (tenant_id, client_id, scope)
    with _token_lock:
        cached = _token_cache.get(cache_key)
        if cached and cached.expires_at > time.time() + TOKEN_REFRESH_BUFFER_SECONDS:
            return cached.token

        # Reuse credential to avoid HTTP connection pool leaks
        cred_key = (tenant_id, client_id)
        credential = _credentials.get(cred_key)
        if credential is None:
            credential = ClientSecretCredential(
                tenant_id=tenant_id,
                client_id=client_id,
                client_secret=client_secret,
            )
            _credentials[cred_key] = credential

        token_response = credential.get_token(scope)

        _token_cache[cache_key] = _CachedToken(
            token=token_response.token,
            expires_at=token_response.expires_on,
        )
        logger.info("🔑 Fabric SP token acquired (expires in %.0fs)", token_response.expires_on - time.time())
        return token_response.token


def _truncate(text: str, max_len: int = 200) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"... ({len(text)} chars total)"


def _resolve_env(env_var_name: str) -> str:
    """Resolve an environment variable name to its value."""
    value = os.environ.get(env_var_name, "")
    if not value:
        raise FabricMcpError(f"Required environment variable '{env_var_name}' is not set")
    return value


_HTTP_TIMEOUT = 115.0  # 5s buffer before the 120s thread timeout
_THREAD_TIMEOUT = 120.0


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.TimeoutException, httpx.NetworkError)),
    before_sleep=lambda rs: logger.warning(
        "⚠️  MCP call retry #%d after %s", rs.attempt_number, rs.outcome.exception(),
    ),
)
async def _call_mcp_async(
    mcp_url: str,
    tool_name: str,
    task: str,
    token: str,
    event_queue: Optional[queue.Queue] = None,
    source_name: str = "",
    timeout: float = _HTTP_TIMEOUT,
) -> str:
    """Call a Fabric MCP endpoint using the full MCP Streamable HTTP protocol.

    Performs the required handshake (initialize → initialized notification)
    before sending the tools/call request.  Handles both SSE and plain JSON
    responses.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:

        # ── Step 1: Initialize the MCP session ────────────────
        init_payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "maf-multi-agent", "version": "0.1.0"},
            },
        }

        init_resp = await client.post(mcp_url, headers=headers, json=init_payload)
        if not init_resp.is_success:
            logger.error("MCP initialize failed: %d %s", init_resp.status_code, init_resp.text[:500])
            init_resp.raise_for_status()

        # Extract session ID if the server provides one
        session_id = init_resp.headers.get("Mcp-Session-Id", "")
        if session_id:
            headers["Mcp-Session-Id"] = session_id
            logger.info("🔗 MCP session established: %s", session_id[:32])

        # Parse initialize response for server info
        init_data = _parse_mcp_response(init_resp.text)
        server_info = init_data.get("result", {}).get("serverInfo", {})
        logger.info("🤝 MCP server: %s", server_info.get("name", "unknown"))

        # ── Step 2: Send initialized notification ─────────────
        notif_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }
        notif_resp = await client.post(mcp_url, headers=headers, json=notif_payload)
        # Notifications may return 200/202/204 — all are acceptable
        if notif_resp.is_error:
            logger.warning("MCP initialized notification: %d %s", notif_resp.status_code, notif_resp.text[:200])

        # ── Step 3: Call the tool ─────────────────────────────
        call_payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": {"userQuestion": task},
            },
        }

        call_resp = await client.post(mcp_url, headers=headers, json=call_payload)
        if not call_resp.is_success:
            logger.error("MCP tools/call failed: %d %s", call_resp.status_code, call_resp.text[:500])
            call_resp.raise_for_status()

    # ── Parse the response ────────────────────────────────────
    result_text = ""
    resp_text = call_resp.text

    # Try SSE format first (lines prefixed with 'data: ')
    for line in resp_text.split("\n"):
        if line.startswith("data: "):
            try:
                parsed = json.loads(line[6:])
                content = parsed.get("result", {}).get("content", [])
                if content:
                    text = content[0].get("text", str(content))
                    result_text = text
                    if event_queue:
                        event_queue.put(AgentEvent(
                            event_type=EventType.AGENT_STREAMING,
                            source=source_name,
                            data={"delta": text},
                        ))
                else:
                    result_text = str(parsed.get("result", parsed))
            except (json.JSONDecodeError, KeyError):
                continue

    # Fallback: plain JSON response
    if not result_text:
        parsed = _parse_mcp_response(resp_text)
        content = parsed.get("result", {}).get("content", [])
        if content:
            result_text = content[0].get("text", str(content))
        elif "result" in parsed:
            result_text = str(parsed["result"])
        else:
            result_text = resp_text

    return result_text


def _parse_mcp_response(text: str) -> dict:
    """Parse an MCP response that may be plain JSON or SSE-wrapped."""
    # Try plain JSON first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from SSE data lines
    for line in text.split("\n"):
        if line.startswith("data: "):
            try:
                return json.loads(line[6:])
            except json.JSONDecodeError:
                continue

    return {}


def run_fabric_mcp(
    mcp_url_env: str,
    mcp_tool_name: str,
    tenant_id_env: str,
    client_id_env: str,
    client_secret_env: str,
    scope: str,
    task: str,
    event_callback: EventCallback = None,
    source_name: str = "",
) -> str:
    """Invoke a Fabric Data Agent MCP tool synchronously.

    Mirrors the interface pattern of foundry_client.run_foundry_agent()
    for drop-in compatibility in agent_loader and dispatcher.

    Args:
        mcp_url_env: Env var name containing the MCP endpoint URL.
        mcp_tool_name: The tool name for the JSON-RPC tools/call request.
        tenant_id_env: Env var name for the SP tenant ID.
        client_id_env: Env var name for the SP client ID.
        client_secret_env: Env var name for the SP client secret.
        scope: OAuth scope for the Fabric API token.
        task: The user question/task to send.
        event_callback: Optional callback for real-time event streaming.
        source_name: Name to identify the source agent in events.

    Returns:
        The MCP tool's text response.
    """
    separator = "─" * 50
    t0 = time.perf_counter()

    logger.info("%s", separator)
    logger.info("🚀 FABRIC MCP CALL     │ tool=%s", mcp_tool_name)
    logger.info("📝 TASK                │ %s", _truncate(task, 300))
    logger.info("⏳ MCP CALL STARTED")

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_STARTED,
            source=source_name,
            data={"agent_name": f"fabric-mcp:{mcp_tool_name}"},
        ))

    # Resolve environment variables
    mcp_url = _resolve_env(mcp_url_env)
    tenant_id = _resolve_env(tenant_id_env)
    client_id = _resolve_env(client_id_env)
    client_secret = _resolve_env(client_secret_env)

    # Acquire (or reuse cached) SP token
    token = _get_token(tenant_id, client_id, client_secret, scope)

    # Thread-safe queue for cross-thread event bridging
    eq: Optional[queue.Queue] = queue.Queue() if event_callback else None

    def _run_in_thread() -> str:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                _call_mcp_async(
                    mcp_url=mcp_url,
                    tool_name=mcp_tool_name,
                    task=task,
                    token=token,
                    event_queue=eq,
                    source_name=source_name,
                )
            )
        finally:
            loop.close()

    try:
        future = _mcp_pool.submit(_run_in_thread)

        if eq is not None and event_callback:
            while not future.done():
                try:
                    evt = eq.get(timeout=0.05)
                    event_callback(evt)
                except queue.Empty:
                    continue

            # Drain remaining events
            while not eq.empty():
                try:
                    event_callback(eq.get_nowait())
                except queue.Empty:
                    break

        response_text = future.result(timeout=_THREAD_TIMEOUT)
    except FabricMcpError:
        raise
    except Exception as e:
        elapsed = time.perf_counter() - t0
        logger.error(
            "❌ MCP CALL FAILED     │ error=%s  (%.1fs)",
            str(e)[:200], elapsed,
        )
        if event_callback:
            event_callback(AgentEvent(
                event_type=EventType.AGENT_ERROR,
                source=source_name,
                data={"error": str(e), "elapsed": elapsed},
            ))
        raise FabricMcpError(f"Fabric MCP call failed: {e}") from e

    elapsed = time.perf_counter() - t0

    logger.info(
        "✅ MCP CALL COMPLETED  │ length=%d chars  (%.1fs)",
        len(response_text), elapsed,
    )
    logger.info("📥 RESPONSE PREVIEW    │ %s", _truncate(response_text, 300))
    logger.info("%s", separator)

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_COMPLETED,
            source=source_name,
            data={"length": len(response_text), "elapsed": elapsed, "result": response_text},
        ))

    return response_text
