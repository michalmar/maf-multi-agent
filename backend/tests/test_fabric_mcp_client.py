"""Unit tests for Fabric MCP response diagnostics and parsing."""

import base64
import json
import queue

import pytest

from src.events import EventType
from src.fabric_mcp_client import (
    FabricMcpError,
    _decode_jwt_claims,
    _extract_text_from_mcp_payload,
    _parse_mcp_call_response,
    _redact_headers,
    _sanitize_url,
)


def test_extract_text_from_all_mcp_content_items():
    payload = {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "content": [
                {"type": "text", "text": "first section"},
                {"type": "text", "text": "second section"},
            ],
        },
    }

    assert _extract_text_from_mcp_payload(payload) == "first section\nsecond section"


def test_parse_sse_call_response_emits_stream_event():
    payload = {
        "jsonrpc": "2.0",
        "id": 2,
        "result": {"content": [{"type": "text", "text": "analysis output"}]},
    }
    events = queue.Queue()
    result = _parse_mcp_call_response(
        f"event: message\ndata: {json.dumps(payload)}\n\n",
        event_queue=events,
        source_name="data_analyst_tool",
    )

    event = events.get_nowait()
    assert result == "analysis output"
    assert event.event_type == EventType.AGENT_STREAMING
    assert event.source == "data_analyst_tool"
    assert event.data == {"delta": "analysis output"}


def test_parse_plain_text_response_falls_back_to_raw_text():
    assert _parse_mcp_call_response("plain response") == "plain response"


def test_json_rpc_error_raises_fabric_mcp_error():
    payload = {
        "jsonrpc": "2.0",
        "id": 2,
        "error": {"code": -32000, "message": "data source failed"},
    }

    with pytest.raises(FabricMcpError, match="data source failed"):
        _extract_text_from_mcp_payload(payload)


def test_redact_headers_hides_bearer_token():
    redacted = _redact_headers({
        "Authorization": "Bearer secret-token",
        "Accept": "application/json",
    })

    assert redacted["Authorization"] == "Bearer <redacted>"
    assert redacted["Accept"] == "application/json"


def test_sanitize_url_removes_query_and_fragment():
    assert (
        _sanitize_url("https://api.fabric.microsoft.com/v1/mcp/workspaces/w/dataagents/a/agent?token=x#frag")
        == "https://api.fabric.microsoft.com/v1/mcp/workspaces/w/dataagents/a/agent"
    )


def test_decode_jwt_claims_for_diagnostics():
    claims = {"aud": "https://api.fabric.microsoft.com", "scp": "Item.Read.All"}
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    token = f"header.{payload}.signature"

    assert _decode_jwt_claims(token) == claims
