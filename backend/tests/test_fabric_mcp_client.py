"""Unit tests for Fabric MCP response diagnostics and parsing."""

import base64
import json
from types import SimpleNamespace

import pytest

from src.events import EventType
from src.fabric_mcp_client import (
    FabricMcpError,
    _decode_jwt_claims,
    _parse_mcp_tool_result,
    _redact_headers,
    _sanitize_url,
    run_fabric_mcp,
)


def test_parse_mcp_tool_result_extracts_all_text_items():
    result = SimpleNamespace(content=[
        SimpleNamespace(type="text", text="first section"),
        SimpleNamespace(type="text", text="second section"),
    ])

    assert _parse_mcp_tool_result(result) == "first section\nsecond section"


def test_parse_mcp_tool_result_returns_structured_content_json():
    result = SimpleNamespace(content=[], structuredContent={"answer": 42})

    assert _parse_mcp_tool_result(result) == '{"answer": 42}'


def test_run_fabric_mcp_uses_user_token_and_emits_lifecycle_events(monkeypatch):
    events = []
    captured = {}

    async def fake_call(mcp_url, tool_name, task, token):
        captured.update({"mcp_url": mcp_url, "tool_name": tool_name, "task": task, "token": token})
        return "analysis output"

    monkeypatch.setenv("FABRIC_DATA_AGENT_MCP_URL", "https://fabric.example/mcp")
    monkeypatch.setattr("src.fabric_mcp_client._call_mcp_async", fake_call)

    result = run_fabric_mcp(
        mcp_url_env="FABRIC_DATA_AGENT_MCP_URL",
        mcp_tool_name="fabric-data-agent",
        task="Analyze telemetry",
        event_callback=events.append,
        source_name="data_analyst_tool",
        user_token="header.eyJhdWQiOiAiZmFicmljIn0.signature",
    )

    assert result == "analysis output"
    assert captured == {
        "mcp_url": "https://fabric.example/mcp",
        "tool_name": "fabric-data-agent",
        "task": "Analyze telemetry",
        "token": "header.eyJhdWQiOiAiZmFicmljIn0.signature",
    }
    assert [event.event_type for event in events] == [
        EventType.AGENT_STARTED,
        EventType.AGENT_STREAMING,
        EventType.AGENT_COMPLETED,
    ]
    assert events[1].data == {"delta": "analysis output"}


def test_run_fabric_mcp_wraps_missing_url_as_fabric_error():
    with pytest.raises(FabricMcpError, match="Required environment variable"):
        run_fabric_mcp(
            mcp_url_env="MISSING_MCP_URL",
            mcp_tool_name="fabric-data-agent",
            task="Analyze telemetry",
            user_token="token",
        )


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
