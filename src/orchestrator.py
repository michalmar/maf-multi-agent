"""MAF orchestrator agent that coordinates Foundry sub-agents.

The orchestrator is a MAF ChatAgent backed by Azure OpenAI. It uses
dynamically loaded function tools (from YAML definitions) to delegate
domain work to Azure AI Foundry managed agents.
"""

import logging
import time
from typing import Optional

from agent_framework.azure import AzureOpenAIResponsesClient
from azure.identity import AzureCliCredential

from src.agent_loader import generate_orchestrator_instructions, load_agents
from src.config import load_config
from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)


def _truncate(text: str, max_len: int = 300) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"... ({len(text)} chars total)"


def attach_reasoning_logger(
    client: AzureOpenAIResponsesClient,
    event_callback: EventCallback = None,
) -> None:
    """Wrap the client's _inner_get_response to log reasoning from each API call.

    This intercepts at the raw API level (below FunctionInvocationLayer),
    so reasoning/tool-call decisions are logged BEFORE tools actually execute.
    Also emits AgentEvent objects via event_callback if provided.
    """
    original_inner = client._inner_get_response
    call_counter = [0]

    def wrapped_inner(*, messages, options, stream=False, **kwargs):
        result = original_inner(messages=messages, options=options, stream=stream, **kwargs)
        if stream:
            return result

        call_counter[0] += 1
        iteration = call_counter[0]

        async def intercept():
            response = await result
            _log_response_phases(response, iteration, event_callback)
            return response

        return intercept()

    client._inner_get_response = wrapped_inner


def _log_response_phases(response, iteration: int, event_callback: EventCallback = None) -> None:
    """Log reasoning, tool-call, and output phases from a single LLM response."""
    has_reasoning = False
    has_tool_calls = False
    has_text = False

    for msg in response.messages:
        for content in msg.contents:
            if content.type == "text_reasoning":
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
        credential=AzureCliCredential(),
        **kwargs,
    )

    attach_reasoning_logger(client)

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
    config = load_config()
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
