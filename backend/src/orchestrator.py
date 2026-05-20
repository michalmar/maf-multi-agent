"""MAF orchestrator agent that coordinates Foundry sub-agents.

The orchestrator is a MAF ChatAgent backed by Azure OpenAI. It uses
dynamically loaded function tools (from YAML definitions) to delegate
domain work to Azure AI Foundry managed agents.
"""

import json
import logging
import time
from typing import Optional

from agent_framework import ChatMiddleware, FunctionMiddleware
from agent_framework.azure import AzureOpenAIResponsesClient
from azure.identity import DefaultAzureCredential

from src.agent_loader import generate_orchestrator_instructions, load_agents
from src.config import get_config
from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)


def _truncate(text: str, max_len: int = 300) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"... ({len(text)} chars total)"


class _TraceState:
    """Shared trace sequence for orchestrator middleware events."""

    def __init__(self):
        self._iteration = 0

    def next_iteration(self) -> int:
        self._iteration += 1
        return self._iteration


def _serialize_tool_arguments(arguments: object) -> str:
    """Serialize MAF function arguments for event payloads."""
    if hasattr(arguments, "model_dump"):
        arguments = arguments.model_dump(exclude_none=True)
    if isinstance(arguments, str):
        return arguments
    try:
        return json.dumps(arguments, default=str)
    except TypeError:
        return str(arguments)


class ReasoningTraceMiddleware(ChatMiddleware):
    """Capture reasoning and output via MAF's public chat middleware hooks."""

    def __init__(self, event_callback: EventCallback = None, trace_state: _TraceState | None = None):
        self._event_callback = event_callback
        self._trace_state = trace_state or _TraceState()

    async def process(self, context, call_next) -> None:
        """Observe each chat response without overriding SDK internals."""
        iteration = self._trace_state.next_iteration()

        if context.stream:

            async def log_stream_result(response):
                _log_response_phases(response, iteration, self._event_callback, include_tool_decisions=False)
                return response

            context.stream_result_hooks.append(log_stream_result)
            await call_next()
            return

        await call_next()
        if context.result is not None:
            _log_response_phases(context.result, iteration, self._event_callback, include_tool_decisions=False)


class ToolDecisionTraceMiddleware(FunctionMiddleware):
    """Emit tool decision events immediately before MAF invokes each function tool."""

    def __init__(self, event_callback: EventCallback = None, trace_state: _TraceState | None = None):
        self._event_callback = event_callback
        self._trace_state = trace_state or _TraceState()

    async def process(self, context, call_next) -> None:
        """Observe function invocations before tool side-effects occur."""
        metadata = getattr(context, "metadata", None)
        if metadata is None:
            metadata = {}
            context.metadata = metadata

        emitted_key = "orchestrator_tool_decision_emitted"
        if metadata.get(emitted_key):
            await call_next()
            return
        metadata[emitted_key] = True

        iteration = self._trace_state.next_iteration()
        tool_name = getattr(context.function, "name", "unknown_tool")
        arguments = _serialize_tool_arguments(context.arguments)

        logger.info("━" * 60)
        logger.info("🔧 TOOL DECISION (iteration #%d)", iteration)
        logger.info("   → %s(%s)", tool_name, _truncate(arguments, 100))
        logger.info("━" * 60)

        if self._event_callback:
            self._event_callback(AgentEvent(
                event_type=EventType.TOOL_DECISION,
                source="orchestrator",
                data={"iteration": iteration, "tool": tool_name, "arguments": arguments},
            ))

        await call_next()


def create_orchestrator_trace_middlewares(event_callback: EventCallback = None) -> list:
    """Create supported MAF middleware for ordered orchestrator trace events."""
    trace_state = _TraceState()
    return [
        ReasoningTraceMiddleware(event_callback=event_callback, trace_state=trace_state),
        ToolDecisionTraceMiddleware(event_callback=event_callback, trace_state=trace_state),
    ]


def create_reasoning_trace_middleware(event_callback: EventCallback = None) -> ReasoningTraceMiddleware:
    """Create the supported MAF middleware used to capture orchestrator reasoning traces."""
    return ReasoningTraceMiddleware(event_callback=event_callback)


def _log_response_phases(
    response,
    iteration: int,
    event_callback: EventCallback = None,
    *,
    include_tool_decisions: bool = True,
) -> None:
    """Log reasoning, tool-call, and output phases from a single LLM response."""
    has_reasoning = False
    has_tool_calls = False
    has_text = False

    for msg in response.messages:
        message_has_function_call = any(content.type == "function_call" for content in msg.contents)
        for content in msg.contents:
            if content.type == "text_reasoning":
                if message_has_function_call and not include_tool_decisions:
                    continue
                if not has_reasoning:
                    logger.info("━" * 60)
                    logger.info("🧠 REASONING PHASE (iteration #%d)", iteration)
                    has_reasoning = True
                reasoning_text = content.text or "(no summary available)"
                if content.text:
                    logger.info("   💭 %s", _truncate(content.text, 500))
                else:
                    logger.info("   💭 (reasoning performed, no summary available)")
                if event_callback:
                    event_callback(AgentEvent(
                        event_type=EventType.REASONING,
                        source="orchestrator",
                        data={"iteration": iteration, "text": reasoning_text},
                    ))

            elif content.type == "function_call":
                if not include_tool_decisions:
                    continue
                if not has_tool_calls and has_reasoning:
                    logger.info("━" * 60)
                if not has_tool_calls:
                    logger.info("━" * 60)
                    logger.info("🔧 TOOL DECISIONS (iteration #%d)", iteration)
                    has_tool_calls = True
                logger.info("   → %s(%s)", content.name, _truncate(content.arguments or "", 100))
                if event_callback:
                    event_callback(AgentEvent(
                        event_type=EventType.TOOL_DECISION,
                        source="orchestrator",
                        data={"iteration": iteration, "tool": content.name, "arguments": content.arguments or ""},
                    ))

            elif content.type == "text":
                has_text = True

    if has_reasoning or has_tool_calls:
        logger.info("━" * 60)

    if has_text:
        for msg in response.messages:
            for content in msg.contents:
                if content.type == "text":
                    logger.info("━" * 60)
                    logger.info("📝 OUTPUT PHASE (iteration #%d)", iteration)
                    logger.info("   📄 %s", _truncate(content.text or "", 500))
                    logger.info("━" * 60)
                    if event_callback:
                        event_callback(AgentEvent(
                            event_type=EventType.OUTPUT,
                            source="orchestrator",
                            data={"iteration": iteration, "text": content.text or ""},
                        ))


def create_orchestrator(
    project_endpoint: Optional[str] = None,
    deployment_name: Optional[str] = None,
    agents_dir: Optional[str] = None,
):
    """Create and return the MAF orchestrator agent.

    Args:
        project_endpoint: Azure AI Foundry project endpoint. If None, read from env.
        deployment_name: Model deployment name. If None, read from env.
        agents_dir: Directory with agent YAML definitions. Defaults to agents/.

    Returns:
        A configured ChatAgent with dynamically loaded tools.
    """
    kwargs = {}
    if project_endpoint:
        kwargs["project_endpoint"] = project_endpoint
    if deployment_name:
        kwargs["deployment_name"] = deployment_name

    logger.info("Creating Azure OpenAI client for orchestrator with kwargs: %s", kwargs)

    client = AzureOpenAIResponsesClient(
        credential=DefaultAzureCredential(),
        middleware=create_orchestrator_trace_middlewares(),
        **kwargs,
    )

    # Load tools from YAML definitions
    tools = load_agents(agents_dir)
    if not tools:
        raise RuntimeError("No agent tools loaded. Check agents/ directory for YAML files.")

    instructions = generate_orchestrator_instructions(tools)

    tool_names = [t.name for t in tools]
    logger.info("━" * 60)
    logger.info("🤖 ORCHESTRATOR CREATED")
    logger.info("   Name:  travel-orchestrator")
    logger.info("   Tools: %s", ", ".join(tool_names))
    logger.info("━" * 60)

    return client.as_agent(
        name="travel-orchestrator",
        instructions=instructions,
        tools=tools,
        default_options={"reasoning": {"effort": "low", "summary": "auto"}},
    )


async def run_query(query: str) -> str:
    """Run a single user query through the orchestrator.

    Args:
        query: The user's travel planning question.

    Returns:
        The orchestrator's synthesized response text.
    """
    config = get_config()
    agent = create_orchestrator(
        project_endpoint=config.project_endpoint,
        deployment_name=config.azure_openai_chat_deployment_name,
    )
    logger.info(f"Using Azure OpenAI deployment: {config.azure_openai_chat_deployment_name}")

    logger.info("━" * 60)
    logger.info("📨 USER QUERY → ORCHESTRATOR")
    logger.info("   Query: %s", query)
    logger.info("━" * 60)

    t0 = time.perf_counter()
    result = await agent.run(query)
    total_elapsed = time.perf_counter() - t0

    logger.info("━" * 60)
    logger.info("✅ ORCHESTRATOR → USER  (total %.1fs)", total_elapsed)
    logger.info("   Response length: %d chars", len(result.text))
    logger.info("━" * 60)

    return result.text
