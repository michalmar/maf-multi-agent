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
from src.file_store import store_file, guess_content_type

logger = logging.getLogger(__name__)

# Shared thread pool for agent invocations — avoids per-call ThreadPoolExecutor overhead
_agent_pool = concurrent.futures.ThreadPoolExecutor(max_workers=10, thread_name_prefix="foundry-agent")


class FoundryAgentError(RuntimeError):
    """Raised when a Foundry agent run fails (non-retryable)."""


def _truncate(text: str, max_len: int = 200) -> str:
    """Truncate text for log display."""
    if len(text) <= max_len:
        return text
    return text[:max_len] + f"... ({len(text)} chars total)"


async def _extract_sandbox_files(openai_client, response, conversation_id: str = "") -> int:
    """Extract and store Code Interpreter sandbox files from a response.

    Strategies:
    1. Response output annotations (file_path or container_file_citation)
    2. Code interpreter call results (image outputs)
    3. Conversation items with file references (fallback if 1+2 yield nothing)

    Returns the number of files successfully downloaded.
    """
    downloaded = 0
    seen_file_ids: set[str] = set()

    logger.info(
        "🔍 Sandbox file extraction started | response type=%s, has output=%s",
        type(response).__name__, hasattr(response, "output"),
    )

    # ── Strategy 1 & 2: Inspect response.output ──────────────────

    if hasattr(response, "output") and response.output:
        item_types = [getattr(item, "type", type(item).__name__) for item in response.output]
        logger.info("🔍 Response output: %d items, types=%s", len(response.output), item_types)

        for item in response.output:
            item_type = getattr(item, "type", None)

            # Strategy 1: Content with annotations (file_path or container_file_citation)
            contents = getattr(item, "content", None) or getattr(item, "contents", None) or []
            if not isinstance(contents, (list, tuple)):
                contents = [contents]

            for content_part in contents:
                if content_part is None:
                    continue
                downloaded += await _process_annotations(
                    openai_client, getattr(content_part, "annotations", None) or [], seen_file_ids,
                )

            # Strategy 2: code_interpreter_call image results
            if item_type == "code_interpreter_call":
                call_obj = getattr(item, "code_interpreter_call", None) or item
                results = getattr(call_obj, "results", None) or getattr(call_obj, "output", None) or []
                for result in results:
                    result_type = getattr(result, "type", None)
                    if result_type == "image":
                        image_obj = getattr(result, "image", None)
                        file_id = getattr(image_obj, "file_id", None) if image_obj else None
                        if file_id and file_id not in seen_file_ids:
                            sandbox_key = f"sandbox:/mnt/data/code_interpreter_{file_id}.png"
                            downloaded += await _download_file(
                                openai_client, file_id, sandbox_key, seen_file_ids,
                            )

    # ── Strategy 3: Fetch conversation items (fallback) ──────────

    if conversation_id and downloaded == 0:
        logger.info("🔍 Strategy 3: Fetching conversation items for conv=%s", conversation_id[:24])
        try:
            items_resp = await openai_client.conversations.items.list(
                conversation_id=conversation_id,
            )
            items_list = []
            if hasattr(items_resp, "__aiter__"):
                async for ci in items_resp:
                    items_list.append(ci)
            elif hasattr(items_resp, "data"):
                items_list = items_resp.data
            elif isinstance(items_resp, list):
                items_list = items_resp

            logger.info("🔍 Conversation items: %d total", len(items_list))

            for ci in items_list:
                ci_content = getattr(ci, "content", None) or []
                if not isinstance(ci_content, (list, tuple)):
                    ci_content = [ci_content]

                for part in ci_content:
                    if part is None:
                        continue
                    # Text parts may have annotations
                    annotations = getattr(part, "annotations", None)
                    if annotations is None:
                        part_text = getattr(part, "text", None)
                        if part_text and hasattr(part_text, "annotations"):
                            annotations = part_text.annotations
                    if annotations:
                        downloaded += await _process_annotations(
                            openai_client, annotations, seen_file_ids,
                        )

                    # Image content parts may have file_id directly
                    part_type = getattr(part, "type", None)
                    if part_type == "image_file":
                        file_id = getattr(part, "file_id", None)
                        if not file_id:
                            img_file = getattr(part, "image_file", None)
                            file_id = getattr(img_file, "file_id", None) if img_file else None
                        if file_id and file_id not in seen_file_ids:
                            sandbox_key = f"sandbox:/mnt/data/conv_image_{file_id}.png"
                            downloaded += await _download_file(
                                openai_client, file_id, sandbox_key, seen_file_ids,
                            )

        except Exception as e:
            logger.warning("⚠️  Conversation items fetch failed: %s", e, exc_info=True)

    logger.info("🔍 Sandbox file extraction done | downloaded=%d", downloaded)
    return downloaded


async def _process_annotations(openai_client, annotations, seen_file_ids: set[str]) -> int:
    """Process annotations from a content part, downloading any referenced files."""
    downloaded = 0
    for ann in annotations:
        ann_type = getattr(ann, "type", None)

        if ann_type == "container_file_citation":
            # Code Interpreter container files (the primary case for Foundry agents)
            container_id = getattr(ann, "container_id", None)
            file_id = getattr(ann, "file_id", None)
            filename = getattr(ann, "filename", None)
            if container_id and file_id and filename:
                sandbox_key = f"sandbox:/mnt/data/{filename}"
                downloaded += await _download_container_file(
                    openai_client, container_id, file_id, sandbox_key, seen_file_ids,
                )
            else:
                logger.debug(
                    "Skipping container_file_citation: container_id=%s, file_id=%s, filename=%s",
                    container_id, file_id, filename,
                )

        elif ann_type == "file_path":
            # Legacy Assistants API file_path annotations
            file_path_obj = getattr(ann, "file_path", None)
            file_id = getattr(file_path_obj, "file_id", None) if file_path_obj else None
            sandbox_text = getattr(ann, "text", None)
            if file_id and sandbox_text:
                downloaded += await _download_file(
                    openai_client, file_id, sandbox_text, seen_file_ids,
                )
        else:
            logger.debug("Skipping annotation type: %s", ann_type)

    return downloaded


async def _download_container_file(
    openai_client,
    container_id: str,
    file_id: str,
    sandbox_key: str,
    seen_file_ids: set[str],
) -> int:
    """Download a file from a Code Interpreter container. Returns 1 on success."""
    if file_id in seen_file_ids:
        return 0

    ct = guess_content_type(sandbox_key)

    # Primary: containers.files.content.retrieve() API
    try:
        resp = await openai_client.containers.files.content.retrieve(
            file_id,
            container_id=container_id,
        )
        data = await _extract_bytes_async(resp)
        if data and len(data) > 0:
            store_file(sandbox_key, data, ct)
            seen_file_ids.add(file_id)
            logger.info("🖼️  Downloaded container file: %s (%d bytes)", sandbox_key, len(data))
            return 1
    except Exception as e:
        logger.info("Container files API failed for %s: %s — trying files API", file_id, e)

    # Fallback: regular files.content API
    return await _download_file(openai_client, file_id, sandbox_key, seen_file_ids)


async def _download_file(
    openai_client,
    file_id: str,
    sandbox_key: str,
    seen_file_ids: set[str],
) -> int:
    """Download a file via the files API. Returns 1 on success, 0 on failure."""
    if file_id in seen_file_ids:
        return 0

    ct = guess_content_type(sandbox_key.replace("sandbox:", ""))

    try:
        resp = await openai_client.files.content(file_id)
        data = await _extract_bytes_async(resp)
        if data and len(data) > 0:
            store_file(sandbox_key, data, ct)
            seen_file_ids.add(file_id)
            logger.info("🖼️  Downloaded file: %s (%d bytes)", sandbox_key, len(data))
            return 1
    except Exception as e:
        logger.debug("files.content failed for %s: %s", file_id, e)

    logger.warning("⚠️  All download methods failed for file_id=%s (%s)", file_id, sandbox_key)
    return 0


async def _extract_bytes_async(resp) -> bytes:
    """Extract raw bytes from various async SDK response types.

    The Azure OpenAI async SDK returns AsyncContent objects where
    .read() is a coroutine that must be awaited.
    """
    if hasattr(resp, "read"):
        result = resp.read()
        # Handle both sync and async .read()
        if asyncio.iscoroutine(result) or asyncio.isfuture(result):
            return await result
        return result
    if hasattr(resp, "content"):
        content = resp.content
        if asyncio.iscoroutine(content):
            return await content
        return content
    if isinstance(resp, bytes):
        return resp
    return bytes(resp)


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
            usage = None
            completed_response = None
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
                    if hasattr(event, 'response'):
                        completed_response = event.response
                        if hasattr(completed_response, 'usage') and completed_response.usage:
                            u = completed_response.usage
                            usage = {
                                "input_tokens": getattr(u, 'input_tokens', 0),
                                "output_tokens": getattr(u, 'output_tokens', 0),
                                "total_tokens": getattr(u, 'total_tokens', 0),
                            }
                else:
                    logger.debug("Stream event: %s", etype)

            # Extract Code Interpreter sandbox files before closing the client
            try:
                n = await _extract_sandbox_files(
                    openai_client,
                    completed_response if completed_response else type("Empty", (), {"output": None})(),
                    conversation_id=conversation.id,
                )
                if n:
                    logger.info("📎 Extracted %d sandbox file(s) from streaming response", n)
            except Exception as e:
                logger.warning("⚠️  Sandbox file extraction failed (streaming): %s", e, exc_info=True)

            return "".join(full_text_parts), usage
        else:
            # Non-streaming mode (backward compatible)
            response = await openai_client.responses.create(
                conversation=conversation.id,
                extra_body=extra_body,
            )
            usage = None
            if hasattr(response, 'usage') and response.usage:
                u = response.usage
                usage = {
                    "input_tokens": getattr(u, 'input_tokens', 0),
                    "output_tokens": getattr(u, 'output_tokens', 0),
                    "total_tokens": getattr(u, 'total_tokens', 0),
                }

            # Extract Code Interpreter sandbox files before closing the client
            try:
                n = await _extract_sandbox_files(
                    openai_client, response, conversation_id=conversation.id,
                )
                if n:
                    logger.info("📎 Extracted %d sandbox file(s) from response", n)
            except Exception as e:
                logger.warning("⚠️  Sandbox file extraction failed: %s", e)

            return response.output_text, usage


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
        future = _agent_pool.submit(_run_in_thread)

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

        response_text, usage = future.result(timeout=120)
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

    tokens_log = ""
    if usage:
        tokens_log = f"  tokens={usage.get('total_tokens', '?')} (in={usage.get('input_tokens', '?')}, out={usage.get('output_tokens', '?')})"

    logger.info(
        "✅ AGENT RUN COMPLETED │ length=%d chars  (%.1fs)%s",
        len(response_text), elapsed, tokens_log,
    )
    logger.info("📥 RESPONSE PREVIEW    │ %s", _truncate(response_text, 300))
    logger.info("%s", separator)

    event_data = {"length": len(response_text), "elapsed": elapsed, "result": response_text}
    if usage:
        event_data["usage"] = usage

    if event_callback:
        event_callback(AgentEvent(
            event_type=EventType.AGENT_COMPLETED,
            source=source_name,
            data=event_data,
        ))

    return response_text
