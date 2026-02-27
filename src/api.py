"""FastAPI server with SSE endpoint for real-time multi-agent orchestration."""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.events import AgentEvent, EventType
from src.agent_loader import list_agent_definitions

load_dotenv()

logger = logging.getLogger(__name__)

app = FastAPI(title="Multi-Agent Travel Planner")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for active runs
_runs: dict[str, asyncio.Queue] = {}
_results: dict[str, dict] = {}


class RunRequest(BaseModel):
    query: str


class RunResponse(BaseModel):
    run_id: str


@app.get("/api/agents")
async def get_agents():
    """Return available agent definitions with avatar and role metadata."""
    # Always include the orchestrator as a built-in agent
    agents = [
        {
            "name": "orchestrator",
            "display_name": "Orchestrator",
            "avatar": "🤖",
            "role": "Facilitator & Coordinator",
            "model": "gpt-5.1",
            "description": "Coordinates all specialist agents, plans tasks, and synthesizes results.",
        }
    ]
    for ad in list_agent_definitions():
        agents.append({
            "name": ad.name,
            "display_name": ad.display_name,
            "avatar": ad.avatar,
            "role": ad.role,
            "model": ad.model,
            "description": ad.description,
        })
    return agents


def _event_to_sse(event: AgentEvent) -> str:
    """Serialize an AgentEvent to an SSE data line."""
    payload = {
        "event_type": event.event_type.value,
        "source": event.source,
        "data": event.data,
        "timestamp": event.timestamp,
    }
    return f"data: {json.dumps(payload)}\n\n"


@app.post("/api/run", response_model=RunResponse)
async def start_run(req: RunRequest):
    """Start a new scratchpad workflow run. Returns a run_id for SSE streaming."""
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    queue: asyncio.Queue = asyncio.Queue()
    _runs[run_id] = queue

    # Event callback bridges sync calls into the async queue
    loop = asyncio.get_event_loop()

    def event_callback(event: AgentEvent):
        loop.call_soon_threadsafe(queue.put_nowait, event)

    # Run workflow in background task
    asyncio.create_task(_run_workflow(run_id, req.query, event_callback))

    return RunResponse(run_id=run_id)


async def _run_workflow(run_id: str, query: str, event_callback):
    """Execute the scratchpad workflow and push events to the queue."""
    queue = _runs[run_id]
    try:
        from src.scratchpad.workflow import run_scratchpad_workflow

        result_text, document_md = await run_scratchpad_workflow(
            query, event_callback=event_callback,
        )

        # Save outputs
        output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")
        os.makedirs(output_dir, exist_ok=True)

        def _save(filename, title, content):
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            header = (
                f"# {title}\n\n"
                f"- **Run ID:** `{run_id}`\n"
                f"- **Timestamp:** {ts}\n"
                f"- **Query:** {query}\n\n---\n\n"
            )
            path = os.path.join(output_dir, f"{run_id}-{filename}.md")
            with open(path, "w") as f:
                f.write(header + content + "\n")
            return path

        _save("result", "Travel Plan — Final Result", result_text)
        if document_md:
            _save("document", "Shared Document", document_md)

        _results[run_id] = {
            "result": result_text,
            "document": document_md or "",
        }

        # Send final result event
        await queue.put(AgentEvent(
            event_type=EventType.OUTPUT,
            source="orchestrator",
            data={"text": result_text, "document": document_md or ""},
        ))

    except Exception as e:
        logger.exception("Workflow failed for run %s", run_id)
        await queue.put(AgentEvent(
            event_type=EventType.AGENT_ERROR,
            source="orchestrator",
            data={"error": str(e)},
        ))

    # Sentinel to signal stream end
    await queue.put(None)


@app.get("/api/stream/{run_id}")
async def stream_events(run_id: str):
    """SSE endpoint — streams AgentEvents for a given run."""
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail="Run not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        queue = _runs[run_id]
        while True:
            event = await queue.get()
            if event is None:
                # Send done sentinel
                yield f"data: {json.dumps({'event_type': 'done'})}\n\n"
                break
            yield _event_to_sse(event)

        # Cleanup
        _runs.pop(run_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/result/{run_id}")
async def get_result(run_id: str):
    """Get the final result for a completed run."""
    if run_id not in _results:
        raise HTTPException(status_code=404, detail="Result not found")
    return _results[run_id]


def setup_logging():
    """Configure logging for API server."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy in [
        "azure.core.pipeline.policies.http_logging_policy",
        "azure.identity",
        "httpx",
        "openai",
    ]:
        logging.getLogger(noisy).setLevel(logging.WARNING)


if __name__ == "__main__":
    import uvicorn
    setup_logging()
    uvicorn.run(app, host="0.0.0.0", port=8000)
