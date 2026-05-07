"""Fabric Data Agent MCP client with flexible authentication.

Calls the Fabric Data Agent MCP endpoint directly via HTTP using
JSON-RPC protocol. Supports two auth modes:

- ``default_credential``: Uses DefaultAzureCredential which resolves to
  Azure CLI locally and Managed Identity in ACA. Recommended.
- ``service_principal``: Uses ClientSecretCredential with explicit SP
  credentials. Legacy fallback.

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
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

import httpx
from azure.identity import ClientSecretCredential, DefaultAzureCredential
from azure.core.exceptions import ClientAuthenticationError

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)

# Shared thread pool for MCP invocations — avoids per-call ThreadPoolExecutor overhead
_mcp_pool = concurrent.futures.ThreadPoolExecutor(max_workers=10, thread_name_prefix="fabric-mcp")

FABRIC_API_SCOPE = "https://api.fabric.microsoft.com/.default"
FABRIC_MCP_DEBUG_ENV = "FABRIC_MCP_DEBUG"
FABRIC_MCP_LOG_BODY_LIMIT_ENV = "FABRIC_MCP_LOG_BODY_LIMIT"
DEFAULT_DIAGNOSTIC_PREVIEW_CHARS = 4_000
TOKEN_REFRESH_BUFFER_SECONDS = 300  # refresh 5 minutes before expiry


class FabricMcpError(RuntimeError):
    """Raised when a Fabric MCP call fails."""


@dataclass
class _CachedToken:
    """In-memory token cache entry."""
    token: str
    expires_at: float  # time.time() based


# Module-level token cache keyed by cache_key string
_token_cache: dict[str, _CachedToken] = {}
_token_lock = threading.Lock()
# Reusable credentials — avoids connection pool leaks
_sp_credentials: dict[tuple[str, str], ClientSecretCredential] = {}
_default_credential: Optional[DefaultAzureCredential] = None


def _get_token_default_credential(scope: str) -> str:
    """Acquire a Fabric API token via DefaultAzureCredential. Thread-safe.

    Resolves to Azure CLI locally, Managed Identity in ACA.
    """
    global _default_credential
    cache_key = f"default:{scope}"
    with _token_lock:
        cached = _token_cache.get(cache_key)
        if cached and cached.expires_at > time.time() + TOKEN_REFRESH_BUFFER_SECONDS:
            return cached.token

        if _default_credential is None:
            managed_identity_client_id = os.environ.get("AZURE_CLIENT_ID", "")
            if managed_identity_client_id:
                _default_credential = DefaultAzureCredential(
                    managed_identity_client_id=managed_identity_client_id,
                )
                logger.info("🔑 Using DefaultAzureCredential with managed_identity_client_id=%s", managed_identity_client_id[:8] + "...")
            else:
                _default_credential = DefaultAzureCredential()
                logger.info("🔑 Using DefaultAzureCredential (auto-resolve)")

        token_response = _default_credential.get_token(scope)

        _token_cache[cache_key] = _CachedToken(
            token=token_response.token,
            expires_at=token_response.expires_on,
        )
        logger.info("🔑 Fabric token acquired via DefaultAzureCredential (expires in %.0fs)", token_response.expires_on - time.time())
        return token_response.token


def _get_token_sp(tenant_id: str, client_id: str, client_secret: str, scope: str) -> str:
    """Acquire a Fabric API token via service principal. Thread-safe."""
    cache_key = f"sp:{tenant_id}:{client_id}:{scope}"
    with _token_lock:
        cached = _token_cache.get(cache_key)
        if cached and cached.expires_at > time.time() + TOKEN_REFRESH_BUFFER_SECONDS:
            return cached.token

        cred_key = (tenant_id, client_id)
        credential = _sp_credentials.get(cred_key)
        if credential is None:
            credential = ClientSecretCredential(
                tenant_id=tenant_id,
                client_id=client_id,
                client_secret=client_secret,
            )
            _sp_credentials[cred_key] = credential

        token_response = credential.get_token(scope)

        _token_cache[cache_key] = _CachedToken(
            token=token_response.token,
            expires_at=token_response.expires_on,
        )
        logger.info("🔑 Fabric SP token acquired (expires in %.0fs)", token_response.expires_on - time.time())
        return token_response.token


def _truncate(text: object, max_len: int = 200) -> str:
    value = text if isinstance(text, str) else str(text)
    if len(value) <= max_len:
        return value
    return value[:max_len] + f"... ({len(value)} chars total)"


def _env_flag(name: str) -> bool:
    value = os.environ.get(name, "")
    return value.strip().lower() in {"1", "true", "yes", "y", "on", "debug"}


def _mcp_debug_enabled() -> bool:
    """Return whether verbose MCP payload/body diagnostics should be emitted."""
    return _env_flag(FABRIC_MCP_DEBUG_ENV) or logger.isEnabledFor(logging.DEBUG)


def _diagnostic_preview_limit() -> int:
    raw = os.environ.get(FABRIC_MCP_LOG_BODY_LIMIT_ENV, "")
    if not raw:
        return DEFAULT_DIAGNOSTIC_PREVIEW_CHARS
    try:
        return max(200, min(int(raw), 50_000))
    except ValueError:
        logger.warning(
            "Invalid %s=%r; using %d chars",
            FABRIC_MCP_LOG_BODY_LIMIT_ENV,
            raw,
            DEFAULT_DIAGNOSTIC_PREVIEW_CHARS,
        )
        return DEFAULT_DIAGNOSTIC_PREVIEW_CHARS


def _json_preview(value: Any, max_len: int | None = None) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, default=str, ensure_ascii=False, sort_keys=True)
    return _truncate(text, max_len or _diagnostic_preview_limit())


def _redact_headers(headers: dict[str, str]) -> dict[str, str]:
    redacted = {}
    for key, value in headers.items():
        if key.lower() == "authorization":
            redacted[key] = "Bearer <redacted>"
        else:
            redacted[key] = value
    return redacted


def _sanitize_url(url: str) -> str:
    """Log endpoint identity without query strings or fragments."""
    try:
        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except ValueError:
        return _truncate(url, 300)


def _log_verbose(label: str, value: Any) -> None:
    """Emit bounded verbose payload diagnostics when debug logging is enabled."""
    if not _mcp_debug_enabled():
        return

    message = "🔎 %s │ %s"
    preview = _json_preview(value)
    if _env_flag(FABRIC_MCP_DEBUG_ENV):
        logger.info(message, label, preview)
    else:
        logger.debug(message, label, preview)


def _resolve_env(env_var_name: str) -> str:
    """Resolve an environment variable name to its value."""
    value = os.environ.get(env_var_name, "")
    if not value:
        raise FabricMcpError(f"Required environment variable '{env_var_name}' is not set")
    return value


def _decode_jwt_claims(token: str) -> dict[str, Any]:
    """Decode JWT payload claims without verifying the signature for diagnostics."""
    import base64
    import binascii

    parts = token.split(".")
    if len(parts) < 2:
        raise ValueError("token does not have a JWT payload segment")

    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload)
    except binascii.Error as e:
        raise ValueError(f"invalid base64 payload: {e}") from e

    data = json.loads(decoded)
    if not isinstance(data, dict):
        raise ValueError("JWT payload is not a JSON object")
    return data


def _log_token_claims(token: str) -> None:
    try:
        claims = _decode_jwt_claims(token)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
        logger.warning("🔑 Could not decode token for diagnostics: %s", e)
        return

    exp = claims.get("exp")
    expires_in = exp - int(time.time()) if isinstance(exp, int) else None
    logger.info(
        "🔑 Token claims        │ aud=%s scp=%s roles=%s user=%s tid=%s oid=%s appid=%s exp=%s expires_in=%s",
        claims.get("aud"),
        claims.get("scp"),
        claims.get("roles"),
        claims.get("preferred_username") or claims.get("upn"),
        claims.get("tid"),
        claims.get("oid"),
        claims.get("appid") or claims.get("azp"),
        exp,
        expires_in,
    )


def _json_rpc_error_message(payload: dict[str, Any]) -> str:
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("code", "unknown")
        message = error.get("message", "")
        data = error.get("data")
        suffix = f" data={_truncate(data, 500)}" if data is not None else ""
        return f"JSON-RPC error {code}: {message}{suffix}"
    return f"JSON-RPC error: {_truncate(error, 500)}"


def _mcp_payload_summary(payload: dict[str, Any]) -> str:
    """Return a compact summary of an MCP JSON-RPC payload."""
    if not payload:
        return "unparsed/empty"

    parts = [f"keys={','.join(payload.keys())}"]
    if "error" in payload:
        parts.append(_json_rpc_error_message(payload))

    result = payload.get("result")
    if isinstance(result, dict):
        parts.append(f"result_keys={','.join(result.keys())}")
        if "isError" in result:
            parts.append(f"isError={result.get('isError')}")
        content = result.get("content")
        if isinstance(content, list):
            content_types = [
                str(item.get("type", type(item).__name__)) if isinstance(item, dict) else type(item).__name__
                for item in content
            ]
            parts.append(f"content_count={len(content)}")
            parts.append(f"content_types={content_types}")
        if "structuredContent" in result:
            structured = result.get("structuredContent")
            if isinstance(structured, dict):
                parts.append(f"structured_keys={','.join(structured.keys())}")
            else:
                parts.append(f"structured_type={type(structured).__name__}")

    return " | ".join(parts)


def _content_item_text(item: Any) -> str:
    if isinstance(item, str):
        return item
    if not isinstance(item, dict):
        return ""

    text = item.get("text")
    if isinstance(text, str):
        return text

    nested_content = item.get("content")
    if isinstance(nested_content, str):
        return nested_content

    return ""


def _extract_text_from_mcp_payload(payload: dict[str, Any]) -> str:
    """Extract all text content from an MCP JSON-RPC response payload."""
    if not payload:
        return ""
    if "error" in payload:
        raise FabricMcpError(_json_rpc_error_message(payload))

    result = payload.get("result")
    if isinstance(result, dict):
        if result.get("isError"):
            logger.warning("⚠️  MCP tool result marked isError=true: %s", _mcp_payload_summary(payload))
        content = result.get("content")
        if isinstance(content, list):
            parts = [text for item in content if (text := _content_item_text(item))]
            if parts:
                return "\n".join(parts)
            if content:
                return json.dumps(content, default=str, ensure_ascii=False)

        structured = result.get("structuredContent")
        if structured is not None:
            return json.dumps(structured, default=str, ensure_ascii=False)

        return json.dumps(result, default=str, ensure_ascii=False)

    if result is not None:
        return str(result)

    return ""


def _iter_sse_json_payloads(text: str):
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        raw = line.removeprefix("data:").strip()
        if not raw or raw == "[DONE]":
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            logger.debug("Skipping non-JSON MCP SSE data line: %s", _truncate(raw, 500))
            continue
        if isinstance(parsed, dict):
            yield parsed


def _parse_mcp_call_response(
    text: str,
    event_queue: Optional[queue.Queue] = None,
    source_name: str = "",
) -> str:
    """Parse an MCP tools/call response and emit streaming events for text."""
    result_parts: list[str] = []
    sse_payload_count = 0

    for parsed in _iter_sse_json_payloads(text):
        sse_payload_count += 1
        logger.info("🧩 MCP SSE payload     │ %s", _mcp_payload_summary(parsed))
        _log_verbose("MCP SSE parsed payload", parsed)
        result_text = _extract_text_from_mcp_payload(parsed)
        if result_text:
            result_parts.append(result_text)
            if event_queue:
                event_queue.put(AgentEvent(
                    event_type=EventType.AGENT_STREAMING,
                    source=source_name,
                    data={"delta": result_text},
                ))

    if sse_payload_count:
        combined = "\n".join(result_parts)
        logger.info(
            "🧩 MCP parse result    │ format=sse payloads=%d result_len=%d",
            sse_payload_count,
            len(combined),
        )
        return combined

    parsed = _parse_mcp_response(text)
    if not parsed:
        logger.warning("⚠️  MCP response was not JSON or SSE; returning raw response text")
        return text

    logger.info("🧩 MCP JSON payload    │ %s", _mcp_payload_summary(parsed))
    _log_verbose("MCP JSON parsed payload", parsed)
    result_text = _extract_text_from_mcp_payload(parsed)
    if not result_text:
        logger.warning("⚠️  MCP JSON payload had no result/error field; returning raw response text")
        result_text = text
    if event_queue and result_text:
        event_queue.put(AgentEvent(
            event_type=EventType.AGENT_STREAMING,
            source=source_name,
            data={"delta": result_text},
        ))

    logger.info(
        "🧩 MCP parse result    │ format=json result_len=%d",
        len(result_text),
    )
    return result_text


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
    logger.info(
        "🌐 MCP endpoint        │ url=%s timeout=%.1fs headers=%s",
        _sanitize_url(mcp_url),
        timeout,
        _redact_headers(headers),
    )

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

        logger.info("➡️  MCP initialize    │ payload=%s", _json_preview(init_payload, 1_000))
        _log_verbose("MCP initialize request headers", _redact_headers(headers))
        init_t0 = time.perf_counter()
        init_resp = await client.post(mcp_url, headers=headers, json=init_payload)
        logger.info(
            "⬅️  MCP initialize    │ status=%d content_type=%s bytes=%d elapsed=%.2fs",
            init_resp.status_code,
            init_resp.headers.get("content-type", ""),
            len(init_resp.text),
            time.perf_counter() - init_t0,
        )
        _log_verbose("MCP initialize response body", init_resp.text)
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
        logger.info("🤝 MCP initialize    │ %s", _mcp_payload_summary(init_data))
        _log_verbose("MCP initialize parsed payload", init_data)
        server_info = init_data.get("result", {}).get("serverInfo", {})
        logger.info("🤝 MCP server: %s", server_info.get("name", "unknown"))

        # ── Step 2: Send initialized notification ─────────────
        notif_payload = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }
        logger.info("➡️  MCP initialized   │ payload=%s", _json_preview(notif_payload, 1_000))
        notif_t0 = time.perf_counter()
        notif_resp = await client.post(mcp_url, headers=headers, json=notif_payload)
        logger.info(
            "⬅️  MCP initialized   │ status=%d content_type=%s bytes=%d elapsed=%.2fs",
            notif_resp.status_code,
            notif_resp.headers.get("content-type", ""),
            len(notif_resp.text),
            time.perf_counter() - notif_t0,
        )
        _log_verbose("MCP initialized response body", notif_resp.text)
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

        logger.info(
            "➡️  MCP tools/call    │ tool=%s question_len=%d question=%s",
            tool_name,
            len(task),
            _truncate(task, _diagnostic_preview_limit()),
        )
        _log_verbose("MCP tools/call request payload", call_payload)
        call_t0 = time.perf_counter()
        call_resp = await client.post(mcp_url, headers=headers, json=call_payload)
        logger.info(
            "⬅️  MCP tools/call    │ status=%d content_type=%s bytes=%d elapsed=%.2fs",
            call_resp.status_code,
            call_resp.headers.get("content-type", ""),
            len(call_resp.text),
            time.perf_counter() - call_t0,
        )
        _log_verbose("MCP tools/call response body", call_resp.text)
        if not call_resp.is_success:
            logger.error("MCP tools/call failed: %d %s", call_resp.status_code, call_resp.text[:500])
            call_resp.raise_for_status()

    # ── Parse the response ────────────────────────────────────
    resp_text = call_resp.text
    result_text = _parse_mcp_call_response(resp_text, event_queue=event_queue, source_name=source_name)
    if not result_text:
        logger.warning("⚠️  MCP tools/call returned no extractable text; raw_bytes=%d", len(resp_text))
    return result_text


def _parse_mcp_response(text: str) -> dict:
    """Parse an MCP response that may be plain JSON or SSE-wrapped."""
    # Try plain JSON first
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        pass

    # Try extracting from SSE data lines
    for parsed in _iter_sse_json_payloads(text):
        return parsed

    return {}


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
    """Invoke a Fabric Data Agent MCP tool synchronously.

    Mirrors the interface pattern of foundry_client.run_foundry_agent()
    for drop-in compatibility in agent_loader and dispatcher.

    Args:
        mcp_url_env: Env var name containing the MCP endpoint URL.
        mcp_tool_name: The tool name for the JSON-RPC tools/call request.
        task: The user question/task to send.
        event_callback: Optional callback for real-time event streaming.
        source_name: Name to identify the source agent in events.
        auth_mode: "default_credential" (recommended) or "service_principal".
        tenant_id_env: Env var name for the SP tenant ID (SP mode only).
        client_id_env: Env var name for the SP client ID (SP mode only).
        client_secret_env: Env var name for the SP client secret (SP mode only).
        scope: OAuth scope for the Fabric API token.
        user_token: Pre-acquired user Bearer token (from Easy Auth header or body).
            When provided, skips credential-based token acquisition.

    Returns:
        The MCP tool's text response.
    """
    separator = "─" * 50
    t0 = time.perf_counter()

    logger.info("%s", separator)
    logger.info("🚀 FABRIC MCP CALL     │ tool=%s", mcp_tool_name)
    logger.info("📝 TASK                │ len=%d preview=%s", len(task), _truncate(task, _diagnostic_preview_limit()))
    logger.info("⏳ MCP CALL STARTED")

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_STARTED,
            source=source_name,
            data={"agent_name": f"fabric-mcp:{mcp_tool_name}"},
        ))

    # Resolve environment variables
    mcp_url = _resolve_env(mcp_url_env)
    logger.info(
        "🧭 MCP CONFIG          │ url_env=%s url=%s auth_mode=%s scope=%s debug=%s",
        mcp_url_env,
        _sanitize_url(mcp_url),
        "user_token" if user_token else auth_mode,
        scope,
        _mcp_debug_enabled(),
    )

    # Acquire token: prefer user_token from Easy Auth, fall back to credential-based
    if user_token:
        token = user_token
        logger.info("🔑 Using pre-acquired user token (Easy Auth / body), length=%d", len(token))
        _log_token_claims(token)
    elif auth_mode == "service_principal":
        tenant_id = _resolve_env(tenant_id_env)
        client_id = _resolve_env(client_id_env)
        client_secret = _resolve_env(client_secret_env)
        token = _get_token_sp(tenant_id, client_id, client_secret, scope)
    else:
        token = _get_token_default_credential(scope)

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
    except FabricMcpError as e:
        elapsed = time.perf_counter() - t0
        logger.error(
            "❌ MCP CALL FAILED     │ error=%s  (%.1fs)",
            str(e)[:500], elapsed,
        )
        if event_callback:
            event_callback(AgentEvent(
                event_type=EventType.AGENT_ERROR,
                source=source_name,
                data={"error": str(e), "elapsed": elapsed},
            ))
        raise
    except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.NetworkError, ClientAuthenticationError) as e:
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
    logger.info("📥 RESPONSE PREVIEW    │ %s", _truncate(response_text, _diagnostic_preview_limit()))
    logger.info("%s", separator)

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_COMPLETED,
            source=source_name,
            data={"length": len(response_text), "elapsed": elapsed, "result": response_text},
        ))

    return response_text
