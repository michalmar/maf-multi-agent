"""AgentDispatcher — creates dispatch tools that invoke Foundry specialist agents."""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Optional

from agent_framework import FunctionTool
from pydantic import BaseModel, Field

from src.agent_loader import AgentDefinition, parse_agent_yaml, DEFAULT_AGENTS_DIR
from src.config import load_config
from src.events import EventCallback
from src.foundry_client import run_foundry_agent
from src.fabric_mcp_client import run_fabric_mcp
from src.scratchpad.taskboard import TaskBoard
from src.scratchpad.shared_document import SharedDocument

logger = logging.getLogger(__name__)


class DispatchInput(BaseModel):
    task_ids: str = Field(description="JSON array of task ID integers to assign to this specialist, e.g. '[1, 2]'")
    message: str = Field(description="Short natural-language instruction for the specialist. Keep it brief — reference task IDs, the task details are on the TaskBoard.")


def _make_dispatch_func(
    agent_def: AgentDefinition,
    taskboard: TaskBoard,
    document: SharedDocument,
    event_callback: EventCallback = None,
    user_token: Optional[str] = None,
):
    """Create an async dispatch closure for a specific specialist agent.

    The closure is async so that the blocking run_foundry_agent call
    is offloaded to a thread via asyncio.to_thread(), keeping the
    event loop free to deliver SSE events in real-time.
    """

    async def _dispatch(task_ids: str, message: str) -> str:
        # Parse task IDs with error handling for malformed LLM output
        try:
            ids = json.loads(task_ids)
            if not isinstance(ids, list):
                ids = [ids]
            ids = [int(x) for x in ids]
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logger.error("❌ Invalid task_ids '%s': %s", task_ids, e)
            return f"Error: task_ids must be a JSON array of integers, got: {task_ids}"

        display = agent_def.display_name.upper().replace(" ", "-")

        logger.info("═" * 60)
        logger.info("📤 DISPATCH: %s (tasks: %s)", display, ids)
        logger.info("💬 Message: %s", message)
        logger.info("═" * 60)

        # Read assigned tasks to build context for the Foundry agent
        tasks = taskboard.read_tasks(ids)
        task_context = "\n".join(f"- Task {t.id}: {t.text}" for t in tasks)

        # Build the full prompt for the Foundry agent
        full_prompt = f"""{message}

Your assigned tasks:
{task_context}

Please provide detailed recommendations for each task. Be specific with names, prices, times, and practical details."""

        # Call the agent in a worker thread so the event loop stays free
        config = load_config()
        t0 = time.perf_counter()
        try:
            if agent_def.agent_type == "mcp":
                auth = agent_def.mcp_auth
                response = await asyncio.to_thread(
                    run_fabric_mcp,
                    mcp_url_env=agent_def.mcp_url_env,
                    mcp_tool_name=agent_def.mcp_tool_name,
                    task=full_prompt,
                    event_callback=event_callback,
                    source_name=agent_def.name,
                    auth_mode=auth.type,
                    tenant_id_env=auth.tenant_id_env,
                    client_id_env=auth.client_id_env,
                    client_secret_env=auth.client_secret_env,
                    scope=auth.scope,
                    user_token=user_token,
                )
            else:
                response = await asyncio.to_thread(
                    run_foundry_agent,
                    project_endpoint=config.project_endpoint,
                    agent_name=agent_def.foundry_agent_name,
                    task=full_prompt,
                    event_callback=event_callback,
                    source_name=agent_def.name,
                )
        except Exception as e:
            logger.error("❌ Dispatch to %s failed: %s", display, e, exc_info=True)
            # Mark tasks as complete so they don't stay in limbo forever
            for task_id in ids:
                try:
                    taskboard.complete_task(task_id)
                except ValueError:
                    pass
            return f"Error: specialist {display} failed: {e}"

        elapsed = time.perf_counter() - t0

        # Write response to the SharedDocument
        document.write_section(
            day=0,
            time_slot="general",
            agent=agent_def.name,
            content=response,
        )

        # Auto-complete assigned tasks (safety net)
        for task_id in ids:
            try:
                taskboard.complete_task(task_id)
            except ValueError:
                logger.warning("⚠️ Could not auto-complete task %d", task_id)

        logger.info("═" * 60)
        logger.info("📥 %s → FACILITATOR (%.1fs)", display, elapsed)
        logger.info("═" * 60)

        # Return summary to facilitator
        return f"{agent_def.display_name} completed {len(ids)} tasks in {elapsed:.1f}s. Results written to the shared document."

    return _dispatch


def create_dispatch_tools(
    taskboard: TaskBoard,
    document: SharedDocument,
    agents_dir: Optional[str] = None,
    event_callback: EventCallback = None,
    selected_agents: Optional[list[str]] = None,
    user_token: Optional[str] = None,
) -> list[FunctionTool]:
    """Create dispatch FunctionTool objects for each agent defined in YAML.

    Args:
        selected_agents: If provided, only create tools for agents whose name
                         is in this list.  When None, all agents are included.

    Returns list of FunctionTool objects named 'call_<agent_name>'.
    """
    agents_path = Path(agents_dir) if agents_dir else DEFAULT_AGENTS_DIR

    if not agents_path.is_dir():
        logger.warning("Agents directory not found: %s", agents_path)
        return []

    selected_set = set(selected_agents) if selected_agents is not None else None
    yaml_files = sorted(agents_path.glob("*.yaml"))
    tools = []

    for yaml_file in yaml_files:
        try:
            agent_def = parse_agent_yaml(yaml_file)

            if selected_set is not None and agent_def.name not in selected_set:
                logger.info("⏭️  Skipping agent %s (not in selected_agents)", agent_def.name)
                continue

            dispatch_func = _make_dispatch_func(
                agent_def, taskboard, document, event_callback,
                user_token=user_token,
            )

            tool = FunctionTool(
                name=f"call_{agent_def.name}",
                description=f"Dispatch the {agent_def.display_name} specialist to work on assigned tasks. {agent_def.description}",
                func=dispatch_func,
                input_model=DispatchInput,
            )
            tools.append(tool)
            logger.info("📂 Dispatch tool created: call_%s", agent_def.name)
        except Exception as e:
            logger.error("❌ Failed to create dispatch tool from %s: %s", yaml_file.name, e)

    return tools
