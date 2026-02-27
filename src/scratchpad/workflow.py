"""Scratchpad workflow — orchestrates the full plan-and-dispatch pattern."""

import logging
import time
from typing import Optional

from agent_framework.azure import AzureOpenAIResponsesClient
from azure.identity import AzureCliCredential

from src.config import load_config
from src.events import AgentEvent, EventCallback, EventType
from src.orchestrator import attach_reasoning_logger
from src.scratchpad.taskboard import TaskBoard
from src.scratchpad.shared_document import SharedDocument
from src.scratchpad.facilitator_tools import FacilitatorTools
from src.scratchpad.dispatcher import create_dispatch_tools

logger = logging.getLogger(__name__)


FACILITATOR_SYSTEM_PROMPT = """\
You are a Travel Planning Facilitator. You coordinate a team of specialist agents to build a comprehensive travel plan.

## Your Team
You have specialist agents available as tools (call_flights_tool, call_hotels_tool, etc.). Each specialist is an expert in their domain.

## Your Workflow (follow these steps IN ORDER)

### Step 1: PLAN
Analyze the user's request and decompose it into specific tasks using the `create_tasks` tool.
- Each task should have a clear `text` description and an `assigned_to` field matching a specialist name
- The `assigned_to` value must match the agent name without the "call_" prefix and without "_tool" suffix (e.g., assign to "flights_tool" for call_flights_tool)
- Create 3-10 tasks total. Don't over-decompose.
- Examples of assigned_to values: "flights_tool", "hotels_tool"

### Step 2: DISPATCH
Call specialist agents to work on their assigned tasks:
- Use `call_flights_tool` for flight-related tasks
- Use `call_hotels_tool` for hotel-related tasks
- Pass the task_ids as a JSON array and a short message
- You can call multiple specialists — they work independently

### Step 3: CHECK
After dispatching, call `get_plan_status` to verify all tasks are completed.
- If tasks are still pending, dispatch more agents or re-dispatch
- If all tasks are done, proceed to review

### Step 4: REVIEW & CONSOLIDATE
- Call `read_document` to see all specialist contributions (with agent tags)
- Call `consolidate_section` to merge overlapping entries into clean sections
- If you find gaps, create follow-up tasks (back to Step 1) and dispatch again

### Step 5: FINAL ANSWER
- Call `read_document_clean` for the final version without agent tags
- Present the consolidated travel plan to the user as your final response
- Add your own synthesis, tips, and recommendations on top

## Important Rules
- Keep messages to specialists SHORT — reference task IDs, the details are on the TaskBoard
- Match the user's language in your final response
- Be concise but informative in the final plan
"""


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
        name="travel-facilitator",
        instructions=FACILITATOR_SYSTEM_PROMPT,
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
