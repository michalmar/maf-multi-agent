"""Scratchpad workflow — orchestrates the full plan-and-dispatch pattern."""

import logging
import time
from pathlib import Path
from typing import Optional

from agent_framework.azure import AzureOpenAIResponsesClient
from azure.identity import AzureCliCredential
from jinja2 import Environment, FileSystemLoader

from src.config import load_config
from src.events import AgentEvent, EventCallback, EventType
from src.orchestrator import attach_reasoning_logger
from src.scratchpad.taskboard import TaskBoard
from src.scratchpad.shared_document import SharedDocument
from src.scratchpad.facilitator_tools import FacilitatorTools
from src.scratchpad.dispatcher import create_dispatch_tools

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def _build_facilitator_prompt(dispatch_tools) -> str:
    """Render the facilitator system prompt from Jinja2 template."""
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), keep_trailing_newline=True)
    template = env.get_template("facilitator_prompt.jinja2")
    return template.render(dispatch_tools=dispatch_tools)


async def run_scratchpad_workflow(
    query: str,
    agents_dir: Optional[str] = None,
    event_callback: EventCallback = None,
) -> tuple[str, str]:
    """Run the full scratchpad workflow for a user query.

    Creates TaskBoard + SharedDocument, builds Facilitator agent with
    FacilitatorTools + dispatch tools, and runs the agent.

    Args:
        query: The user's travel planning question.
        agents_dir: Directory with agent YAML definitions.
        event_callback: Optional callback for real-time event streaming.

    Returns a tuple of (facilitator's final response text, shared document markdown).
    """
    config = load_config()

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.WORKFLOW_STARTED,
            source="orchestrator",
            data={"query": query},
        ))

    # Create shared data structures
    taskboard = TaskBoard(event_callback=event_callback)
    document = SharedDocument(event_callback=event_callback)

    # Build tools
    facilitator_tools = FacilitatorTools(taskboard, document)
    dispatch_tools = create_dispatch_tools(
        taskboard, document, agents_dir,
        event_callback=event_callback,
    )

    all_tools = facilitator_tools.get_tools() + dispatch_tools

    if not dispatch_tools:
        raise RuntimeError("No dispatch tools created. Check agents/ directory.")

    # Build dynamic facilitator prompt from template
    facilitator_prompt = _build_facilitator_prompt(dispatch_tools)

    # Create the Facilitator agent
    client = AzureOpenAIResponsesClient(
        credential=AzureCliCredential(),
        project_endpoint=config.project_endpoint,
        deployment_name=config.azure_openai_chat_deployment_name,
    )

    attach_reasoning_logger(client, event_callback=event_callback)

    logger.info(f"Using Azure OpenAI deployment: {config.azure_openai_chat_deployment_name}")

    tool_names = [t.name for t in all_tools]
    logger.info("━" * 60)
    logger.info("🎯 SCRATCHPAD WORKFLOW STARTED")
    logger.info("   Tools: %s", ", ".join(tool_names))
    logger.info("━" * 60)

    facilitator = client.as_agent(
        name="facilitator",
        instructions=facilitator_prompt,
        tools=all_tools,
        default_options={"reasoning": {"effort": "low", "summary": "auto"}},
    )

    logger.info("━" * 60)
    logger.info("📨 USER QUERY → FACILITATOR")
    logger.info("   Query: %s", query)
    logger.info("━" * 60)

    t0 = time.perf_counter()
    result = await facilitator.run(query)
    total_elapsed = time.perf_counter() - t0

    # Log final status
    logger.info("━" * 60)
    logger.info("✅ WORKFLOW COMPLETE (%.1fs)", total_elapsed)
    logger.info("   Tasks: %s", taskboard.get_status_summary().split('\n')[0])
    logger.info("   Document version: %d", document.version)
    logger.info("   Response length: %d chars", len(result.text))
    logger.info("━" * 60)

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.WORKFLOW_COMPLETED,
            source="orchestrator",
            data={
                "elapsed": total_elapsed,
                "tasks_completed": taskboard.get_status_summary().split('\n')[0],
                "document_version": document.version,
                "response_length": len(result.text),
            },
        ))

    return result.text, document.raw_contributions
