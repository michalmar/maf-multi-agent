"""Shared Azure AI Foundry client and agent invocation helper.

Uses the Responses API (conversations) from Azure AI Foundry to invoke
Prompt Agents by name. Sub-agents are run in separate threads with their
own event loops to avoid conflicts with the orchestrator's async loop.

Supports streaming: when an event_callback is provided, text deltas from
the sub-agent are emitted in real-time via AgentEvent.
"""

import asyncio
import concurrent.futures
import logging
import queue
import time
from typing import Optional

from azure.identity.aio import DefaultAzureCredential
from azure.ai.projects.aio import AIProjectClient

from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)


class FoundryAgentError(RuntimeError):
    """Raised when a Foundry agent run fails (non-retryable)."""


def _truncate(text: str, max_len: int = 200) -> str:
    """Truncate text for log display."""
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"... ({len(text)} chars total)"


async def _run_agent_async(
    project_endpoint: str,
    agent_name: str,
    task: str,
    event_queue: Optional[queue.Queue] = None,
    source_name: str = "",
) -> str:
    """Run a Foundry Prompt Agent using the Responses API (conversations).

    If event_queue is provided, streams the response and pushes AgentEvent
    objects to the queue for real-time display.
    """
    async with (
        DefaultAzureCredential() as credential,
        AIProjectClient(endpoint=project_endpoint, credential=credential) as project_client,
        project_client.get_openai_client() as openai_client,
    ):
        # Retrieve the agent by name to validate it exists
        agent = await project_client.agents.get(agent_name=agent_name)
        logger.info(
            "📎 AGENT RESOLVED      │ name=%s  id=%s  version=%s",
            agent.name, agent.id, agent.versions.latest.version,
        )

        # Create a new conversation
        conversation = await openai_client.conversations.create()
        logger.info("💬 CONVERSATION        │ id=%s", conversation.id)

        # Add user message to conversation
        await openai_client.conversations.items.create(
            conversation_id=conversation.id,
            items=[{"type": "message", "role": "user", "content": task}],
        )

        extra_body = {
            "agent_reference": {
                "name": agent.name,
                "type": "agent_reference",
            }
        }

        if event_queue is not None:
            # Streaming mode
            stream = await openai_client.responses.create(
                conversation=conversation.id,
                stream=True,
                extra_body=extra_body,
            )

            full_text_parts: list[str] = []
            async for event in stream:
                etype = type(event).__name__
                if etype == "ResponseTextDeltaEvent":
                    delta = event.delta
                    full_text_parts.append(delta)
                    event_queue.put(AgentEvent(
                        event_type=EventType.AGENT_STREAMING,
                        source=source_name,
                        data={"delta": delta},
                    ))
                elif etype == "ResponseCompletedEvent":
                    pass  # handled after loop

            return "".join(full_text_parts)
        else:
            # Non-streaming mode (backward compatible)
            response = await openai_client.responses.create(
                conversation=conversation.id,
                extra_body=extra_body,
            )
            return response.output_text


def run_foundry_agent(
    project_endpoint: str,
    agent_name: str,
    task: str,
    event_callback: EventCallback = None,
    source_name: str = "",
) -> str:
    """Invoke a Foundry Prompt Agent synchronously from a sync tool context.

    Runs the async Responses API flow in a separate thread with its own
    event loop to avoid conflicts with the orchestrator's running loop.

    If event_callback is provided, streams the response and calls the
    callback with AgentEvent objects in real-time.

    Args:
        project_endpoint: The Azure AI Foundry project endpoint.
        agent_name: The Foundry agent name (e.g. 'flight-agent-v2').
        task: The user message / task to send to the agent.
        event_callback: Optional callback for real-time event streaming.
        source_name: Name to identify the source agent in events.

    Returns:
        The agent's text response.
    """
    separator = "─" * 50
    t0 = time.perf_counter()

    logger.info("%s", separator)
    logger.info("🚀 FOUNDRY AGENT CALL  │ agent=%s", agent_name)
    logger.info("📝 TASK                │ %s", _truncate(task, 300))
    logger.info("⏳ AGENT RUN STARTED")

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_STARTED,
            source=source_name,
            data={"agent_name": agent_name},
        ))

    # Thread-safe queue for cross-thread event bridging
    eq: Optional[queue.Queue] = queue.Queue() if event_callback else None

    def _run_in_thread() -> str:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(
                _run_agent_async(
                    project_endpoint, agent_name, task,
                    event_queue=eq,
                    source_name=source_name,
                )
            )
        finally:
            loop.close()

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_run_in_thread)

            if eq is not None and event_callback:
                # Bridge events from worker thread to callback while waiting
                while not future.done():
                    try:
                        evt = eq.get(timeout=0.05)
                        event_callback(evt)
                    except queue.Empty:
                        continue

                # Drain remaining events after future completes
                while not eq.empty():
                    try:
                        event_callback(eq.get_nowait())
                    except queue.Empty:
                        break

            response_text = future.result(timeout=120)
    except FoundryAgentError:
        raise
    except Exception as e:
        elapsed = time.perf_counter() - t0
        logger.error(
            "❌ AGENT RUN FAILED    │ error=%s  (%.1fs)",
            str(e)[:200], elapsed,
        )
        if event_callback:
            event_callback(AgentEvent(
                event_type=EventType.AGENT_ERROR,
                source=source_name,
                data={"error": str(e), "elapsed": elapsed},
            ))
        raise FoundryAgentError(f"Foundry agent run failed: {e}") from e

    elapsed = time.perf_counter() - t0

    logger.info(
        "✅ AGENT RUN COMPLETED │ length=%d chars  (%.1fs)",
        len(response_text), elapsed,
    )
    logger.info("📥 RESPONSE PREVIEW    │ %s", _truncate(response_text, 300))
    logger.info("%s", separator)

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_COMPLETED,
            source=source_name,
            data={"length": len(response_text), "elapsed": elapsed},
        ))

    return response_text
