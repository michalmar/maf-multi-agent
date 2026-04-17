"""FastAPI server with SSE endpoint for real-time multi-agent orchestration."""

import asyncio
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator

import yaml

from dotenv import load_dotenv

# Load env vars from .env before any config reads. Search common locations:
# backend/.env, then repo-root .env (one level up from backend/).
for _env_candidate in (
    Path(__file__).resolve().parent.parent / ".env",
    Path(__file__).resolve().parent.parent.parent / ".env",
):
    if _env_candidate.exists():
        load_dotenv(_env_candidate, override=False)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from src.config import get_config
from src.events import AgentEvent, EventType
from src.agent_loader import list_agent_definitions
from src.fabric_capacity import get_fabric_capacity_status, resume_fabric_capacity
from src.file_store import get_file, rewrite_sandbox_urls, rewrite_sandbox_urls_for_disk, copy_run_files, get_all_files
from src.history_store import get_history_store
from src.run_store import RunStore

logger = logging.getLogger(__name__)


def _extract_email_from_token(token: str | None) -> str | None:
    """Best-effort email extraction from a JWT access token.

    WARNING: This does NOT verify the token signature. It is safe to use ONLY
    when the token has already been validated by an upstream gateway (e.g., Azure
    Container Apps Easy Auth). Never use this as the sole identity check.

    The primary identity source is _resolve_user_email() which reads the
    pre-validated X-MS-CLIENT-PRINCIPAL-NAME header from Easy Auth.
    """
    if not token:
        return None
    try:
        import base64
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return claims.get("preferred_username") or claims.get("upn") or None
    except Exception:
        return None


# Regex: strip chars unsafe for directory names (keep alphanumeric, @, ., -, _)
_SAFE_EMAIL_RE = re.compile(r"[^a-zA-Z0-9@.\-_]")


def _safe_user_dir(email: str) -> str:
    """Sanitize an email address into a safe directory name."""
    return _SAFE_EMAIL_RE.sub("_", email.lower().strip())


def _resolve_user_email(request: Request) -> str | None:
    """Extract user email from Easy Auth header or query param (local dev fallback)."""
    return (
        request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME")
        or request.query_params.get("user_email")
        or None
    )


def _is_super_user(user_email: str | None) -> bool:
    """Check if the authenticated user is the configured super-user."""
    if not user_email:
        return False
    from src.config import get_config
    su = get_config().super_user_email
    return bool(su and user_email.lower().strip() == su.lower().strip())


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize logging and observability on startup."""
    setup_logging()
    from src.observability import setup_observability
    await setup_observability()
    app.state.run_store = RunStore()
    yield


app = FastAPI(title="MAF & Foundry Agent Orchestration", lifespan=lifespan)

_config = get_config()
_origins = [o.strip() for o in _config.allowed_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _store(request_or_app=None) -> RunStore:
    """Return the RunStore instance from app state."""
    return app.state.run_store


class RunRequest(BaseModel):
    query: str
    selected_agents: list[str] | None = None
    reasoning_effort: str | None = "low"  # "high", "medium", "low", or "none"
    user_token: str | None = None  # Fabric user token (Easy Auth header or body)
    user_email: str | None = None  # Logged-in user's email (for email notifications)


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


@app.get("/api/version")
async def get_version():
    """Return build version info injected at Docker build time."""
    return {
        "version": os.getenv("APP_VERSION", "dev"),
        "git_sha": os.getenv("GIT_SHA", "unknown"),
        "build_date": os.getenv("BUILD_DATE", "unknown"),
    }


def _event_to_sse(event: AgentEvent) -> str:
    """Serialize an AgentEvent to an SSE data line.

    Rewrites ``sandbox:`` URLs in text fields so the frontend can
    render images via the ``/api/files/`` endpoint.
    """
    data = event.data

    # Rewrite sandbox: URLs in text fields destined for the frontend
    _TEXT_KEYS = ("text", "result", "content")
    rewritten = False
    for key in _TEXT_KEYS:
        val = data.get(key)
        if isinstance(val, str) and "sandbox:" in val:
            if not rewritten:
                data = dict(data)  # shallow copy once
                rewritten = True
            data[key] = rewrite_sandbox_urls(val)

    payload = {
        "event_type": event.event_type.value,
        "source": event.source,
        "data": data,
        "timestamp": event.timestamp,
        "event_summary": event.event_summary,
    }
    return f"data: {json.dumps(payload)}\n\n"


@app.post("/api/run", response_model=RunResponse)
async def start_run(req: RunRequest, request: Request):
    """Start a new scratchpad workflow run. Returns a run_id for SSE streaming."""
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]

    # Resolve Fabric user token: Easy Auth header (ACA) > body field (local dev) > None
    user_token = (
        request.headers.get("X-MS-TOKEN-AAD-ACCESS-TOKEN")
        or req.user_token
        or None
    )
    token_source = (
        "easyauth-header" if request.headers.get("X-MS-TOKEN-AAD-ACCESS-TOKEN")
        else "body" if req.user_token
        else "absent"
    )

    # Resolve user email: Easy Auth principal header > body field > JWT decode.
    # JWT fallback is safe here because the token was already validated upstream
    # by Easy Auth (ACA) or is a local-dev token from az login.
    user_email = (
        request.headers.get("X-MS-CLIENT-PRINCIPAL-NAME")
        or req.user_email
        or _extract_email_from_token(user_token)
    )

    logger.info("🚀 RUN %s | user_token=%s | user_email=%s", run_id, token_source, user_email or "absent")
    store = _store()
    run_state = store.create(run_id)
    queue = run_state.queue

    # Collect events for session snapshot (thread-safe list)
    collected_events: list[dict] = []

    # Event callback bridges sync calls into the async queue
    loop = asyncio.get_event_loop()

    def event_callback(event: AgentEvent):
        if event.event_type != EventType.AGENT_STREAMING:
            # Serialize and collect for session snapshot
            collected_events.append({
                "event_type": event.event_type.value,
                "source": event.source,
                "data": event.data,
                "timestamp": event.timestamp,
                "event_summary": event.event_summary,
            })
            logger.info(
                "EVENT [%s] source=%s | %s",
                event.event_type.value,
                event.source,
                json.dumps(event.data, default=str)[:200],
            )
        loop.call_soon_threadsafe(queue.put_nowait, event)

    # Run workflow in background task
    asyncio.create_task(_run_workflow(run_id, req.query, event_callback, req.selected_agents, collected_events, req.reasoning_effort, user_token, user_email))

    return RunResponse(run_id=run_id)


async def _run_workflow(
    run_id: str,
    query: str,
    event_callback,
    selected_agents: list[str] | None = None,
    collected_events: list[dict] | None = None,
    reasoning_effort: str | None = "low",
    user_token: str | None = None,
    user_email: str | None = None,
):
    """Execute the scratchpad workflow and push events to the queue."""
    store = _store()
    run_state = store.get(run_id)
    if not run_state:
        logger.error("Run %s not found in store", run_id)
        return
    queue = run_state.queue
    workflow_status = "done"
    user_dir = _safe_user_dir(user_email) if user_email else ""

    # Ensure local output dir exists for markdown artifacts + sandbox files
    output_dir = _get_output_dir()
    local_run_dir = os.path.join(output_dir, user_dir, run_id) if user_dir else os.path.join(output_dir, run_id)
    os.makedirs(local_run_dir, exist_ok=True)

    try:
        from src.scratchpad.workflow import run_scratchpad_workflow

        result_text, document_md = await run_scratchpad_workflow(
            query, event_callback=event_callback,
            selected_agents=selected_agents,
            reasoning_effort=reasoning_effort,
            user_token=user_token,
            user_email=user_email,
        )

        # Copy sandbox files into local run folder (for disk-based markdown)
        copy_run_files(local_run_dir)

        store.set_result(run_id, {
            "result": rewrite_sandbox_urls(result_text) if result_text else "",
            "document": rewrite_sandbox_urls(document_md) if document_md else "",
        })

        # Send final result event (URL rewriting happens in _event_to_sse)
        await queue.put(AgentEvent(
            event_type=EventType.OUTPUT,
            source="orchestrator",
            data={"text": result_text, "document": document_md or ""},
        ))

        # Save session snapshot via history store (blob or local)
        await _save_session_snapshot(
            run_id, user_dir, query, collected_events or [],
            rewrite_sandbox_urls(result_text) if result_text else "",
            rewrite_sandbox_urls(document_md) if document_md else "",
            workflow_status,
            user_email,
        )

    except Exception as e:
        workflow_status = "error"
        logger.exception("Workflow failed for run %s", run_id)
        await queue.put(AgentEvent(
            event_type=EventType.AGENT_ERROR,
            source="orchestrator",
            data={"error": str(e)},
        ))
        # Save snapshot even on failure so we don't lose debug context
        try:
            await _save_session_snapshot(
                run_id, user_dir, query, collected_events or [],
                "", "", "error",
                user_email,
            )
        except Exception:
            logger.warning("⚠️  Failed to save error snapshot for %s", run_id)

    # Sentinel to signal stream end
    await queue.put(None)


_SSE_KEEPALIVE_INTERVAL = 15  # seconds between heartbeat comments


@app.get("/api/stream/{run_id}")
async def stream_events(run_id: str):
    """SSE endpoint — streams AgentEvents for a given run."""
    store = _store()
    run_state = store.get(run_id)
    if not run_state:
        raise HTTPException(status_code=404, detail="Run not found")

    # Reject duplicate connections — asyncio.Queue is single-consumer;
    # a second client would steal events from the first.
    if store.is_streaming(run_id):
        raise HTTPException(
            status_code=409,
            detail="Another client is already streaming this run",
        )
    store.set_streaming(run_id, True)

    async def event_generator() -> AsyncGenerator[str, None]:
        queue = run_state.queue
        while True:
            try:
                event = await asyncio.wait_for(
                    queue.get(), timeout=_SSE_KEEPALIVE_INTERVAL,
                )
            except asyncio.TimeoutError:
                # No event within the keepalive window — send an SSE
                # comment to prevent proxy idle-timeout disconnects
                # (e.g. Azure Container Apps / Envoy ingress).
                yield ": keepalive\n\n"
                continue

            if event is None:
                # Send done sentinel
                yield f"data: {json.dumps({'event_type': 'done'})}\n\n"
                break
            # Skip streaming deltas — they flood the SSE connection and
            # the frontend filters them out anyway.
            if event.event_type == EventType.AGENT_STREAMING:
                continue
            yield _event_to_sse(event)

        # Cleanup — remove run state to prevent memory leaks
        store.remove(run_id)

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
    store = _store()
    result = store.get_result(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")
    return result


# ── Sandbox file serving ──────────────────────────────────────

@app.get("/api/files/{file_key:path}")
async def serve_file(file_key: str):
    """Serve a Code Interpreter sandbox file downloaded from Azure.

    The file_key is the URL-encoded sandbox path (e.g., ``%2Fmnt%2Fdata%2Fplot.png``).
    """
    import urllib.parse

    decoded_key = urllib.parse.unquote(file_key)
    # Try both with and without leading slash
    entry = get_file(f"sandbox:{decoded_key}")
    if entry is None and not decoded_key.startswith("/"):
        entry = get_file(f"sandbox:/{decoded_key}")
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")

    data, content_type = entry
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Disposition": f"inline",
        },
    )


# ── Fabric Capacity Status ────────────────────────────────────

@app.get("/api/fabric/status")
async def fabric_status():
    """Check Fabric capacity state (Active, Paused, Suspended, etc.)."""
    return await get_fabric_capacity_status()


@app.post("/api/fabric/resume")
async def fabric_resume():
    """Resume a paused/suspended Fabric capacity."""
    return await resume_fabric_capacity()


# ── Session snapshot & history ─────────────────────────────────


def _aggregate_token_usage(events: list[dict], agent_model_map: dict[str, str]) -> dict | None:
    """Aggregate token usage from collected events into a structured breakdown.

    Returns a dict with totals, per-source breakdown (agent + model), and
    token type breakdown (input/output/cached/reasoning), or None if no usage.
    """
    totals = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
              "cached_tokens": 0, "reasoning_tokens": 0}
    by_source: dict[str, dict] = {}

    config = get_config()
    orchestrator_model = config.azure_openai_chat_deployment_name

    for ev in events:
        et = ev.get("event_type", "")
        data = ev.get("data", {})
        source = ev.get("source", "")

        usage = data.get("usage")
        if et == "agent_completed" and usage:
            model = agent_model_map.get(source, "unknown")
            _add_usage(totals, by_source, source, model, usage)

        if et == "workflow_completed":
            if usage:
                _add_usage(totals, by_source, "orchestrator", orchestrator_model, usage)
            # Summary service usage (separate model)
            su = data.get("summary_usage")
            if su:
                summary_model = su.get("model", config.azure_openai_summary_deployment_name)
                _add_usage(totals, by_source, "summary", summary_model, su)

    if totals["total_tokens"] == 0:
        return None

    # Clean up zero values
    for key in ("cached_tokens", "reasoning_tokens"):
        if totals[key] == 0:
            del totals[key]

    return {**totals, "by_source": by_source}


def _add_usage(totals: dict, by_source: dict, source: str, model: str, usage: dict) -> None:
    """Add usage data from one source to the totals and per-source breakdown."""
    inp = usage.get("input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0
    tot = usage.get("total_tokens", 0) or 0
    cached = usage.get("cached_tokens", 0) or 0
    reasoning = usage.get("reasoning_tokens", 0) or 0

    totals["input_tokens"] += inp
    totals["output_tokens"] += out
    totals["total_tokens"] += tot
    totals["cached_tokens"] += cached
    totals["reasoning_tokens"] += reasoning

    if source not in by_source:
        by_source[source] = {"model": model, "input_tokens": 0, "output_tokens": 0,
                             "total_tokens": 0}
    entry = by_source[source]
    entry["input_tokens"] += inp
    entry["output_tokens"] += out
    entry["total_tokens"] += tot
    if cached:
        entry["cached_tokens"] = entry.get("cached_tokens", 0) + cached
    if reasoning:
        entry["reasoning_tokens"] = entry.get("reasoning_tokens", 0) + reasoning

async def _save_session_snapshot(
    run_id: str,
    user_dir: str,
    query: str,
    events: list[dict],
    result_text: str,
    document_md: str,
    status: str,
    user_email: str | None = None,
) -> None:
    """Save a complete session snapshot via the history store."""
    try:
        # Derive tasks and documents from collected events
        tasks: list[dict] = []
        documents: list[dict] = []
        agents_seen: dict[str, dict] = {}

        for ev in events:
            et = ev.get("event_type", "")
            data = ev.get("data", {})

            if et == "tasks_created" and data.get("tasks"):
                tasks = data["tasks"]

            if et == "task_completed" and data.get("task_id") is not None:
                tid = data["task_id"]
                for t in tasks:
                    if t.get("id") == tid:
                        t["finished"] = True

            if et == "document_updated" and data.get("content"):
                documents.append({
                    "version": data.get("version", len(documents) + 1),
                    "content": rewrite_sandbox_urls(data["content"]),
                    "action": (data.get("history") or {}).get("action", "update"),
                })

            # Track agents
            source = ev.get("source", "")
            if source and source != "orchestrator" and source != "document":
                if source not in agents_seen:
                    agents_seen[source] = {"name": source, "display_name": source}

        # Add final document version
        if document_md:
            documents.append({"version": "final", "content": document_md, "action": "final"})

        # Rewrite sandbox URLs in all collected event text fields
        rewritten_events = []
        for ev in events:
            ev_copy = dict(ev)
            data = ev_copy.get("data", {})
            if isinstance(data, dict):
                data_copy = dict(data)
                for key in ("text", "result", "content"):
                    val = data_copy.get(key)
                    if isinstance(val, str) and "sandbox:" in val:
                        data_copy[key] = rewrite_sandbox_urls(val)
                ev_copy["data"] = data_copy
            rewritten_events.append(ev_copy)

        # Load agent definitions for the snapshot
        try:
            from src.agent_loader import list_agent_definitions
            agent_defs_raw = list_agent_definitions()
            agent_defs = [
                {"name": a.name, "display_name": a.display_name, "avatar": a.avatar,
                 "role": a.role, "model": a.model, "description": a.description}
                for a in agent_defs_raw
            ]
            # Build agent→model mapping for token usage attribution
            agent_model_map = {a.name: a.model for a in agent_defs_raw}
        except (yaml.YAMLError, OSError, ImportError):
            agent_defs = list(agents_seen.values())
            agent_model_map = {}

        # Aggregate token usage from events
        token_usage = _aggregate_token_usage(events, agent_model_map)

        snapshot = {
            "run_id": run_id,
            "user_email": user_email,
            "query": query,
            "timestamp": datetime.now().isoformat(),
            "status": status,
            "agents": agent_defs,
            "events": rewritten_events,
            "tasks": tasks,
            "documents": documents,
            "result": result_text,
            "stream_label": f"Replay of run {run_id}",
        }
        if token_usage:
            snapshot["token_usage"] = token_usage

        history = get_history_store()
        await history.save_session(user_dir, run_id, snapshot)

        # Also save sandbox files to the history store
        for sandbox_path, (data, _ct) in get_all_files().items():
            filename = os.path.basename(sandbox_path.replace("sandbox:", ""))
            if filename:
                try:
                    await history.save_file(user_dir, run_id, filename, data)
                except Exception:
                    logger.debug("Skipped blob file save for %s", filename)

    except Exception as e:
        logger.warning("⚠️  Failed to save session snapshot for %s: %s", run_id, e)


def _get_output_dir() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


# Regex: only allow alphanumeric, hyphens, underscores (no .. or /)
_SAFE_RUN_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_run_id(run_id: str) -> None:
    """Validate run_id to prevent path traversal."""
    if not _SAFE_RUN_ID_RE.match(run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id")


@app.get("/api/history")
async def list_history(request: Request):
    """List saved session snapshots for the authenticated user, newest first."""
    user_email = _resolve_user_email(request)
    history = get_history_store()

    if _is_super_user(user_email):
        return await history.list_all_sessions(include_user=True)

    user_dir = _safe_user_dir(user_email) if user_email else ""
    return await history.list_sessions(user_dir)


@app.get("/api/history/{run_id}")
async def get_history_session(run_id: str, request: Request):
    """Load a complete session snapshot for replay (scoped to authenticated user)."""
    _validate_run_id(run_id)
    user_email = _resolve_user_email(request)
    history = get_history_store()

    if _is_super_user(user_email):
        result = await history.find_session_any_user(run_id)
        if not result:
            raise HTTPException(status_code=404, detail="Session not found")
        return result[1]

    user_dir = _safe_user_dir(user_email) if user_email else ""
    snap = await history.get_session(user_dir, run_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


@app.delete("/api/history/{run_id}")
async def delete_history_session(run_id: str, request: Request):
    """Delete a saved session (scoped to authenticated user)."""
    _validate_run_id(run_id)
    user_email = _resolve_user_email(request)
    history = get_history_store()

    if _is_super_user(user_email):
        result = await history.find_session_any_user(run_id)
        if not result:
            raise HTTPException(status_code=404, detail="Session not found")
        user_dir = result[0]
    else:
        user_dir = _safe_user_dir(user_email) if user_email else ""

    deleted = await history.delete_session(user_dir, run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": run_id}


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
        "azure.monitor.opentelemetry.exporter",
        "httpx",
        "openai",
    ]:
        logging.getLogger(noisy).setLevel(logging.WARNING)


if __name__ == "__main__":
    import uvicorn
    setup_logging()
    uvicorn.run(app, host="0.0.0.0", port=8000)
