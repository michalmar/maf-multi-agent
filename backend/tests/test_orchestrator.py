"""Unit tests for orchestrator module."""

from types import SimpleNamespace
from unittest.mock import patch, MagicMock

import pytest
import yaml

from src.events import EventType
from src.orchestrator import (
    ReasoningTraceMiddleware,
    ToolDecisionTraceMiddleware,
    create_orchestrator,
)


@pytest.fixture
def agents_dir(tmp_path):
    """Create a temp agents directory with one test agent."""
    agent = tmp_path / "test.yaml"
    agent.write_text(yaml.dump({
        "name": "test_tool",
        "display_name": "Test Agent",
        "description": "A test agent.",
        "task_description": "A test task.",
        "foundry_agent_name": "test-agent-v1",
    }))
    return tmp_path


@patch("src.orchestrator.FoundryChatClient")
@patch("src.orchestrator.DefaultAzureCredential")
def test_create_orchestrator(mock_cred, mock_client_cls, agents_dir):
    """create_orchestrator returns an agent with dynamically loaded tools."""
    mock_client = MagicMock()
    mock_agent = MagicMock()
    mock_client.as_agent.return_value = mock_agent
    mock_client_cls.return_value = mock_client

    agent = create_orchestrator(agents_dir=str(agents_dir))

    assert agent is mock_agent
    mock_client.as_agent.assert_called_once()
    call_kwargs = mock_client.as_agent.call_args.kwargs
    assert call_kwargs["name"] == "travel-orchestrator"
    assert len(call_kwargs["tools"]) == 1
    assert call_kwargs["tools"][0].name == "test_tool"
    assert "test_tool" in call_kwargs["instructions"]
    constructor_kwargs = mock_client_cls.call_args.kwargs
    assert isinstance(constructor_kwargs["middleware"][0], ReasoningTraceMiddleware)
    assert isinstance(constructor_kwargs["middleware"][1], ToolDecisionTraceMiddleware)


@patch("src.orchestrator.FoundryChatClient")
@patch("src.orchestrator.DefaultAzureCredential")
def test_create_orchestrator_with_custom_params(mock_cred, mock_client_cls, agents_dir):
    """create_orchestrator accepts optional endpoint and deployment_name."""
    mock_client = MagicMock()
    mock_client.as_agent.return_value = MagicMock()
    mock_client_cls.return_value = mock_client

    create_orchestrator(
        project_endpoint="https://custom.services.ai.azure.com/api/projects/test",
        deployment_name="gpt-4o-mini",
        agents_dir=str(agents_dir),
    )

    mock_client_cls.assert_called_once_with(
        credential=mock_cred.return_value,
        project_endpoint="https://custom.services.ai.azure.com/api/projects/test",
        model="gpt-4o-mini",
        middleware=mock_client_cls.call_args.kwargs["middleware"],
    )


@pytest.mark.asyncio
async def test_reasoning_trace_middleware_logs_response_phases():
    """ReasoningTraceMiddleware emits reasoning/output events from public chat middleware results."""
    events = []
    middleware = ReasoningTraceMiddleware(event_callback=events.append)
    response = SimpleNamespace(messages=[
        SimpleNamespace(contents=[
            SimpleNamespace(type="text_reasoning", text="thinking through the plan"),
            SimpleNamespace(type="text", text="final answer"),
        ])
    ])
    context = SimpleNamespace(stream=False, result=None)

    async def call_next():
        context.result = response

    await middleware.process(context, call_next)

    assert [event.event_type for event in events] == [
        EventType.REASONING,
        EventType.OUTPUT,
    ]
    assert events[0].data == {"iteration": 1, "text": "thinking through the plan"}
    assert events[1].data == {"iteration": 1, "text": "final answer"}


@pytest.mark.asyncio
async def test_reasoning_trace_middleware_skips_stale_tool_call_messages():
    """Tool-call messages replayed by MAF after execution should not create late timeline events."""
    events = []
    middleware = ReasoningTraceMiddleware(event_callback=events.append)
    response = SimpleNamespace(messages=[
        SimpleNamespace(contents=[
            SimpleNamespace(type="text_reasoning", text="planning before a tool"),
            SimpleNamespace(type="function_call", name="test_tool", arguments='{"task_ids":[1]}'),
        ]),
        SimpleNamespace(contents=[
            SimpleNamespace(type="text", text="final answer"),
        ]),
    ])
    context = SimpleNamespace(stream=False, result=None)

    async def call_next():
        context.result = response

    await middleware.process(context, call_next)

    assert [event.event_type for event in events] == [EventType.OUTPUT]
    assert events[0].data == {"iteration": 1, "text": "final answer"}


@pytest.mark.asyncio
async def test_tool_decision_trace_middleware_emits_before_tool_execution():
    """Tool decisions are emitted before the corresponding function tool side-effects."""
    order = []
    events = []
    middleware = ToolDecisionTraceMiddleware(event_callback=lambda event: (order.append("event"), events.append(event)))
    context = SimpleNamespace(
        function=SimpleNamespace(name="create_tasks"),
        arguments={"tasks": [{"text": "Analyze telemetry"}]},
    )

    async def call_next():
        order.append("tool")

    await middleware.process(context, call_next)

    assert order == ["event", "tool"]
    assert events[0].event_type == EventType.TOOL_DECISION
    assert events[0].data == {
        "iteration": 1,
        "tool": "create_tasks",
        "arguments": '{"tasks": [{"text": "Analyze telemetry"}]}',
    }


@pytest.mark.asyncio
async def test_tool_decision_trace_middleware_suppresses_nested_duplicate_emission():
    """If MAF routes the same function context through duplicate middleware, emit once."""
    order = []
    events = []
    first = ToolDecisionTraceMiddleware(event_callback=lambda event: events.append(event))
    second = ToolDecisionTraceMiddleware(event_callback=lambda event: events.append(event))
    context = SimpleNamespace(
        function=SimpleNamespace(name="call_websearch_tool"),
        arguments={"task_ids": [4]},
        metadata={},
    )

    async def final_tool_call():
        order.append("tool")

    async def nested_duplicate():
        await second.process(context, final_tool_call)

    await first.process(context, nested_duplicate)

    assert order == ["tool"]
    assert len(events) == 1
    assert events[0].event_type == EventType.TOOL_DECISION
    assert events[0].data == {
        "iteration": 1,
        "tool": "call_websearch_tool",
        "arguments": '{"task_ids": [4]}',
    }


@pytest.mark.asyncio
async def test_reasoning_trace_middleware_uses_stream_result_hook():
    """Streaming responses are observed through MAF's stream result hook."""
    events = []
    middleware = ReasoningTraceMiddleware(event_callback=events.append)
    response = SimpleNamespace(messages=[
        SimpleNamespace(contents=[
            SimpleNamespace(type="text", text="streamed final answer"),
        ])
    ])
    context = SimpleNamespace(stream=True, result=object(), stream_result_hooks=[])

    async def call_next():
        return None

    await middleware.process(context, call_next)
    assert len(context.stream_result_hooks) == 1
    assert await context.stream_result_hooks[0](response) is response
    assert events[0].event_type == EventType.OUTPUT
    assert events[0].data == {"iteration": 1, "text": "streamed final answer"}


@patch("src.orchestrator.FoundryChatClient")
@patch("src.orchestrator.DefaultAzureCredential")
def test_create_orchestrator_no_agents_raises(mock_cred, mock_client_cls, tmp_path):
    """create_orchestrator raises if no agent YAML files are found."""
    with pytest.raises(RuntimeError, match="No agent tools loaded"):
        create_orchestrator(agents_dir=str(tmp_path))
