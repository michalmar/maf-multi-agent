"""Scratchpad workflow — orchestrates the full plan-and-dispatch pattern."""

import logging
import time
from pathlib import Path
from typing import Optional

from agent_framework.azure import AzureOpenAIResponsesClient
from azure.identity import DefaultAzureCredential
from jinja2 import Environment, FileSystemLoader

from src.config import get_config
from src.events import AgentEvent, EventCallback, EventType
from src.orchestrator import attach_reasoning_logger
from src.scratchpad.taskboard import TaskBoard
from src.scratchpad.shared_document import SharedDocument
from src.scratchpad.facilitator_tools import FacilitatorTools
from src.scratchpad.dispatcher import create_dispatch_tools
from src.scratchpad.mail_tools import MailTools
from src.summary import SummaryService

logger = logging.getLogger(__name__)

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def _build_facilitator_prompt(dispatch_tools, has_mail_tools: bool = False, user_email: str = "") -> str:
    """Render the facilitator system prompt from Jinja2 template."""
    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR), keep_trailing_newline=True)
    template = env.get_template("facilitator_prompt.jinja2")
    return template.render(
        dispatch_tools=dispatch_tools,
        has_mail_tools=has_mail_tools,
        user_email=user_email,
    )


async def run_scratchpad_workflow(
    query: str,
    agents_dir: Optional[str] = None,
    event_callback: EventCallback = None,
    selected_agents: Optional[list[str]] = None,
    reasoning_effort: Optional[str] = "low",
    user_token: Optional[str] = None,
    user_email: Optional[str] = None,
) -> tuple[str, str]:
    """Run the full scratchpad workflow for a user query.

    Creates TaskBoard + SharedDocument, builds Facilitator agent with
    FacilitatorTools + dispatch tools (+ optional mail tools), and runs the agent.

    Args:
        query: The user's travel planning question.
        agents_dir: Directory with agent YAML definitions.
        event_callback: Optional callback for real-time event streaming.
        selected_agents: Optional list of agent names to include. If None, all agents are used.
        reasoning_effort: Reasoning effort level: "high", "medium", "low", or "none".
        user_token: Fabric user token from Easy Auth or local dev.
        user_email: Logged-in user's email for email notifications.

    Returns a tuple of (facilitator's final response text, shared document markdown).
    """
    config = get_config()

    # Create summary service for enriching events with LLM-generated summaries
    summary_service = SummaryService()

    # Wrap the raw event callback to inject summaries before emission
    raw_callback = event_callback

    def enriched_callback(event: AgentEvent) -> None:
        if raw_callback is None:
            return
        if not event.event_summary:
            event.event_summary = summary_service.generate_summary_safe(event)
        raw_callback(event)

    event_callback = enriched_callback if raw_callback else None

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
        selected_agents=selected_agents,
        user_token=user_token,
    )

    all_tools = facilitator_tools.get_tools() + dispatch_tools

    # Add mail tools if configured (MAIL_SENDER_ADDRESS set + user email available)
    has_mail_tools = False
    if config.mail_enabled and user_email:
        mail_tools = MailTools(user_email=user_email, config=config)
        all_tools = all_tools + mail_tools.get_tools()
        has_mail_tools = True
        logger.info("📧 Mail tools enabled: sender=%s, recipient=%s", config.mail_sender_address, user_email)
    elif not config.mail_enabled:
        logger.info("📧 Mail tools disabled (MAIL_SENDER_ADDRESS not set)")
    else:
        logger.info("📧 Mail tools disabled (no user email available)")

    if not dispatch_tools:
        raise RuntimeError("No dispatch tools created. Check agents/ directory.")

    # Build dynamic facilitator prompt from template
    facilitator_prompt = _build_facilitator_prompt(
        dispatch_tools,
        has_mail_tools=has_mail_tools,
        user_email=user_email or "",
    )

    # Create the Facilitator agent
    client = AzureOpenAIResponsesClient(
        credential=DefaultAzureCredential(),
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

    # Build reasoning options based on the requested effort level
    if reasoning_effort and reasoning_effort != "none":
        default_options = {"reasoning": {"effort": reasoning_effort, "summary": "auto"}}
    else:
        default_options = {}

    facilitator = client.as_agent(
        name="facilitator",
        instructions=facilitator_prompt,
        tools=all_tools,
        default_options=default_options,
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
