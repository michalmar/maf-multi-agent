"""FastAPI server with SSE endpoint for real-time multi-agent orchestration."""

import asyncio
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

import yaml

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from src.config import get_config
from src.events import AgentEvent, EventType
from src.agent_loader import list_agent_definitions
from src.fabric_capacity import get_fabric_capacity_status, resume_fabric_capacity
from src.file_store import get_file, rewrite_sandbox_urls, rewrite_sandbox_urls_for_disk, copy_run_files
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
    su = os.environ.get("SUPER_USER_EMAIL", "")
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

    # Compute run directory upfront — scoped by user when email is available
    output_dir = _get_output_dir()
    if user_email:
        user_dir = os.path.join(output_dir, _safe_user_dir(user_email))
    else:
        user_dir = output_dir
    run_dir = os.path.join(user_dir, run_id)
    os.makedirs(run_dir, exist_ok=True)

    try:
        from src.scratchpad.workflow import run_scratchpad_workflow

        result_text, document_md = await run_scratchpad_workflow(
            query, event_callback=event_callback,
            selected_agents=selected_agents,
            reasoning_effort=reasoning_effort,
            user_token=user_token,
            user_email=user_email,
        )

        def _save(filename, title, content):
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            header = (
                f"# {title}\n\n"
                f"- **Run ID:** `{run_id}`\n"
                f"- **Timestamp:** {ts}\n"
                f"- **Query:** {query}\n\n---\n\n"
            )
            rewritten = rewrite_sandbox_urls_for_disk(content) if content else ""
            path = os.path.join(run_dir, f"{filename}.md")
            with open(path, "w") as f:
                f.write(header + rewritten + "\n")
            return path

        _save("result", "Final Result", result_text)
        if document_md:
            _save("document", "Shared Document", document_md)

        # Copy sandbox files into run folder so markdown + images are self-contained
        copy_run_files(run_dir)

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

        # Save session snapshot for replay
        _save_session_snapshot(
            run_id, run_dir, query, collected_events or [],
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
            _save_session_snapshot(
                run_id, run_dir, query, collected_events or [],
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

def _save_session_snapshot(
    run_id: str,
    run_dir: str,
    query: str,
    events: list[dict],
    result_text: str,
    document_md: str,
    status: str,
    user_email: str | None = None,
) -> None:
    """Save a complete session snapshot for replay mode."""
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
            agent_defs = [
                {"name": a.name, "display_name": a.display_name, "avatar": a.avatar,
                 "role": a.role, "model": a.model, "description": a.description}
                for a in list_agent_definitions()
            ]
        except (yaml.YAMLError, OSError, ImportError):
            agent_defs = list(agents_seen.values())

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

        path = os.path.join(run_dir, "session.json")
        with open(path, "w") as f:
            json.dump(snapshot, f, default=str, indent=2)

        logger.info("📸 Session snapshot saved: %s", path)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        logger.warning("⚠️  Failed to save session snapshot for %s: %s", run_id, e)


def _get_output_dir() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


# Regex: only allow alphanumeric, hyphens, underscores (no .. or /)
_SAFE_RUN_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_run_id(run_id: str) -> str:
    """Validate run_id to prevent path traversal. Returns the resolved directory path."""
    if not _SAFE_RUN_ID_RE.match(run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    resolved = os.path.realpath(os.path.join(_get_output_dir(), run_id))
    if not resolved.startswith(os.path.realpath(_get_output_dir())):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    return resolved


def _validate_user_run(run_id: str, user_email: str | None) -> str:
    """Validate run_id and return the user-scoped directory path."""
    if not _SAFE_RUN_ID_RE.match(run_id):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    output_dir = _get_output_dir()
    if user_email:
        base_dir = os.path.join(output_dir, _safe_user_dir(user_email))
    else:
        base_dir = output_dir
    resolved = os.path.realpath(os.path.join(base_dir, run_id))
    if not resolved.startswith(os.path.realpath(base_dir)):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    return resolved


def _find_run_dir_any_user(run_id: str) -> str | None:
    """Search all user directories for a run_id (super-user access)."""
    if not _SAFE_RUN_ID_RE.match(run_id):
        return None
    output_dir = _get_output_dir()
    if not os.path.isdir(output_dir):
        return None
    for user_entry in os.listdir(output_dir):
        user_path = os.path.join(output_dir, user_entry)
        if not os.path.isdir(user_path):
            continue
        candidate = os.path.join(user_path, run_id)
        if os.path.isdir(candidate) and os.path.isfile(os.path.join(candidate, "session.json")):
            return candidate
    return None


def _list_sessions_in_dir(scan_dir: str, include_user: bool = False) -> list[dict]:
    """List session snapshots in a directory, newest first."""
    items: list[dict] = []
    if not os.path.isdir(scan_dir):
        return items
    for entry in sorted(os.listdir(scan_dir), reverse=True):
        if not _SAFE_RUN_ID_RE.match(entry):
            continue
        session_path = os.path.join(scan_dir, entry, "session.json")
        if not os.path.isfile(session_path):
            continue
        try:
            with open(session_path) as f:
                snap = json.load(f)
            item: dict = {
                "run_id": snap.get("run_id", entry),
                "query": snap.get("query", "")[:200],
                "timestamp": snap.get("timestamp", ""),
                "status": snap.get("status", "unknown"),
                "event_count": len(snap.get("events", [])),
                "has_result": bool(snap.get("result")),
            }
            if include_user:
                item["user_email"] = snap.get("user_email")
            items.append(item)
        except Exception:
            continue
    return items


@app.get("/api/history")
async def list_history(request: Request):
    """List saved session snapshots for the authenticated user, newest first."""
    user_email = _resolve_user_email(request)
    output_dir = _get_output_dir()
    is_su = _is_super_user(user_email)

    if is_su:
        # Super-user: scan all user directories
        items: list[dict] = []
        if os.path.isdir(output_dir):
            for user_entry in os.listdir(output_dir):
                user_path = os.path.join(output_dir, user_entry)
                if not os.path.isdir(user_path):
                    continue
                # Skip non-session dirs (e.g. sandbox_files)
                if user_entry == "sandbox_files":
                    continue
                items.extend(_list_sessions_in_dir(user_path, include_user=True))
        # Sort all items newest first by run_id (YYYYMMDD-HHMMSS prefix)
        items.sort(key=lambda x: x["run_id"], reverse=True)
        return items

    if user_email:
        scan_dir = os.path.join(output_dir, _safe_user_dir(user_email))
    else:
        # No user identity — scan all top-level run folders (local dev / legacy)
        scan_dir = output_dir

    return _list_sessions_in_dir(scan_dir)


@app.get("/api/history/{run_id}")
async def get_history_session(run_id: str, request: Request):
    """Load a complete session snapshot for replay (scoped to authenticated user)."""
    user_email = _resolve_user_email(request)

    if _is_super_user(user_email):
        run_dir = _find_run_dir_any_user(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Session not found")
    else:
        run_dir = _validate_user_run(run_id, user_email)

    session_path = os.path.join(run_dir, "session.json")
    if not os.path.isfile(session_path):
        raise HTTPException(status_code=404, detail="Session not found")

    with open(session_path) as f:
        return json.load(f)


@app.delete("/api/history/{run_id}")
async def delete_history_session(run_id: str, request: Request):
    """Delete a saved session and its output folder (scoped to authenticated user)."""
    import shutil
    user_email = _resolve_user_email(request)

    if _is_super_user(user_email):
        run_dir = _find_run_dir_any_user(run_id)
        if not run_dir:
            raise HTTPException(status_code=404, detail="Session not found")
    else:
        run_dir = _validate_user_run(run_id, user_email)

    if not os.path.isdir(run_dir):
        raise HTTPException(status_code=404, detail="Session not found")
    shutil.rmtree(run_dir)
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
