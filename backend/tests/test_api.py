"""Tests for API helpers and result fallback behavior."""

import re

from fastapi.testclient import TestClient

from src.api import app, _build_session_snapshot
from src import file_store


def test_build_session_snapshot_tracks_running_progress():
    """Running snapshots should preserve partial progress for resume/reload."""
    created_at = "2026-04-21T10:00:00"
    events = [
        {
            "event_type": "workflow_started",
            "source": "orchestrator",
            "data": {"query": "test query"},
            "timestamp": 1.0,
            "event_summary": "",
        },
        {
            "event_type": "tasks_created",
            "source": "orchestrator",
            "data": {
                "tasks": [
                    {"id": 1, "text": "Investigate", "assigned_to": "kb_tool", "finished": False},
                ]
            },
            "timestamp": 2.0,
            "event_summary": "",
        },
        {
            "event_type": "task_completed",
            "source": "orchestrator",
            "data": {"task_id": 1},
            "timestamp": 3.0,
            "event_summary": "",
        },
        {
            "event_type": "document_updated",
            "source": "document",
            "data": {"version": 1, "content": "draft 1", "history": {"action": "write"}},
            "timestamp": 4.0,
            "event_summary": "",
        },
    ]

    snapshot = _build_session_snapshot(
        run_id="20260421-100000-abc123",
        query="test query",
        events=events,
        result_text="",
        document_md="",
        status="running",
        created_at=created_at,
        user_email="user@example.com",
    )

    assert snapshot["status"] == "running"
    assert snapshot["timestamp"] == created_at
    assert snapshot["updated_at"]
    assert snapshot["tasks"][0]["finished"] is True
    assert snapshot["documents"][0]["content"] == "draft 1"
    assert snapshot["result"] == ""


class _StubHistoryStore:
    def __init__(self, snapshot: dict | None = None, sessions: dict[str, dict[str, dict]] | None = None):
        self.snapshot = snapshot
        self.sessions = sessions or {}
        if snapshot is not None:
            self.sessions.setdefault("user@example.com", {})["run-123"] = snapshot
        self.deleted: list[tuple[str, str]] = []

    async def list_sessions(self, user_dir: str | None, include_user: bool = False) -> list[dict]:
        sessions = self.sessions.get(user_dir or "", {})
        return [
            {
                "run_id": run_id,
                "query": snap.get("query", ""),
                "timestamp": snap.get("timestamp", ""),
                "updated_at": snap.get("updated_at", ""),
                "status": snap.get("status", "done"),
                "event_count": len(snap.get("events", [])),
                "has_result": bool(snap.get("result")),
            }
            for run_id, snap in sessions.items()
        ]

    async def list_all_sessions(self, include_user: bool = True) -> list[dict]:
        items: list[dict] = []
        for user_dir, sessions in self.sessions.items():
            for run_id, snap in sessions.items():
                item = {
                    "run_id": run_id,
                    "query": snap.get("query", ""),
                    "timestamp": snap.get("timestamp", ""),
                    "updated_at": snap.get("updated_at", ""),
                    "status": snap.get("status", "done"),
                    "event_count": len(snap.get("events", [])),
                    "has_result": bool(snap.get("result")),
                }
                if include_user:
                    item["user_email"] = snap.get("user_email", user_dir)
                items.append(item)
        return items

    async def get_session(self, user_dir: str, run_id: str) -> dict | None:
        return self.sessions.get(user_dir, {}).get(run_id)

    async def delete_session(self, user_dir: str, run_id: str) -> bool:
        if run_id not in self.sessions.get(user_dir, {}):
            return False
        del self.sessions[user_dir][run_id]
        self.deleted.append((user_dir, run_id))
        return True

    async def find_session_any_user(self, run_id: str):
        for user_dir, sessions in self.sessions.items():
            if run_id in sessions:
                return user_dir, sessions[run_id]
        return None


class _StubConfig:
    def __init__(self, *, super_user_email: str = "", allow_anonymous_local_dev: bool = False):
        self.super_user_email = super_user_email
        self.allow_anonymous_local_dev = allow_anonymous_local_dev


def test_get_result_falls_back_to_saved_session(monkeypatch):
    """Completed results should still be retrievable after in-memory state is gone."""
    snapshot = {
        "result": "Saved result",
        "documents": [
            {"version": 1, "content": "draft", "action": "write"},
            {"version": "final", "content": "final document", "action": "final"},
        ],
    }
    monkeypatch.setattr("src.api.get_history_store", lambda: _StubHistoryStore(snapshot))

    with TestClient(app) as client:
        response = client.get(
            "/api/result/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "user@example.com"},
        )

    assert response.status_code == 200
    assert response.json() == {"result": "Saved result", "document": "final document"}


def test_history_and_result_require_identity(monkeypatch):
    """Persisted session endpoints should fail closed when identity is missing."""
    monkeypatch.setattr("src.api.get_history_store", lambda: _StubHistoryStore())
    monkeypatch.setattr("src.api.get_config", lambda: _StubConfig())

    with TestClient(app) as client:
        responses = [
            client.get("/api/history"),
            client.get("/api/history/run-123"),
            client.get("/api/result/run-123"),
            client.delete("/api/history/run-123"),
        ]

    assert [response.status_code for response in responses] == [401, 401, 401, 401]


def test_history_access_is_scoped_to_authenticated_user(monkeypatch):
    """A non-owner should not be able to read another user's saved run."""
    snapshot = {"run_id": "run-123", "result": "Saved", "documents": []}
    store = _StubHistoryStore(sessions={"owner@example.com": {"run-123": snapshot}})
    monkeypatch.setattr("src.api.get_history_store", lambda: store)
    monkeypatch.setattr("src.api.get_config", lambda: _StubConfig())

    with TestClient(app) as client:
        wrong_user = client.get(
            "/api/history/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "intruder@example.com"},
        )
        owner = client.get(
            "/api/history/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "owner@example.com"},
        )

    assert wrong_user.status_code == 404
    assert owner.status_code == 200
    assert owner.json()["result"] == "Saved"


def test_super_user_can_access_and_delete_cross_user_history(monkeypatch):
    """The configured super-user keeps cross-user history access."""
    snapshot = {"run_id": "run-123", "result": "Saved", "documents": []}
    store = _StubHistoryStore(sessions={"owner@example.com": {"run-123": snapshot}})
    monkeypatch.setattr("src.api.get_history_store", lambda: store)
    monkeypatch.setattr("src.api.get_config", lambda: _StubConfig(super_user_email="admin@example.com"))

    with TestClient(app) as client:
        read_response = client.get(
            "/api/history/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "admin@example.com"},
        )
        delete_response = client.delete(
            "/api/history/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "admin@example.com"},
        )

    assert read_response.status_code == 200
    assert delete_response.status_code == 200
    assert store.deleted == [("owner@example.com", "run-123")]


def test_anonymous_history_requires_explicit_local_dev_flag(monkeypatch):
    """Anonymous root history access is available only when explicitly enabled."""
    snapshot = {"run_id": "run-123", "result": "Saved", "documents": []}
    store = _StubHistoryStore(sessions={"": {"run-123": snapshot}})
    monkeypatch.setattr("src.api.get_history_store", lambda: store)
    monkeypatch.setattr(
        "src.api.get_config",
        lambda: _StubConfig(allow_anonymous_local_dev=True),
    )

    with TestClient(app) as client:
        response = client.get("/api/history")

    assert response.status_code == 200
    assert response.json()[0]["run_id"] == "run-123"


def test_invalid_run_ids_are_rejected_before_history_lookup(monkeypatch):
    """History/result/delete endpoints should reject unsafe run IDs."""
    monkeypatch.setattr("src.api.get_history_store", lambda: _StubHistoryStore())
    monkeypatch.setattr("src.api.get_config", lambda: _StubConfig())

    with TestClient(app) as client:
        responses = [
            client.get("/api/history/bad.run", headers={"X-MS-CLIENT-PRINCIPAL-NAME": "user@example.com"}),
            client.get("/api/result/bad.run", headers={"X-MS-CLIENT-PRINCIPAL-NAME": "user@example.com"}),
            client.delete("/api/history/bad.run", headers={"X-MS-CLIENT-PRINCIPAL-NAME": "user@example.com"}),
        ]

    assert [response.status_code for response in responses] == [400, 400, 400]


def test_active_result_is_scoped_to_run_owner(monkeypatch):
    """In-memory results should not bypass user scoping before persistence."""
    monkeypatch.setattr("src.api.get_history_store", lambda: _StubHistoryStore())
    monkeypatch.setattr("src.api.get_config", lambda: _StubConfig())

    with TestClient(app) as client:
        run_state = app.state.run_store.create("run-123", user_dir="owner@example.com")
        run_state.result = {"result": "live result", "document": ""}

        wrong_user = client.get(
            "/api/result/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "intruder@example.com"},
        )
        owner = client.get(
            "/api/result/run-123",
            headers={"X-MS-CLIENT-PRINCIPAL-NAME": "owner@example.com"},
        )

    assert wrong_user.status_code == 404
    assert owner.status_code == 200
    assert owner.json()["result"] == "live result"


def test_files_endpoint_serves_stored_file_keys(tmp_path, monkeypatch):
    """Sandbox file serving should resolve unique file keys, not only sandbox paths."""
    monkeypatch.setattr(file_store, "_PERSIST_DIR", tmp_path)
    file_store._reset_for_tests()
    file_store.store_file("sandbox:/mnt/data/report.png", b"png-bytes", "image/png")
    rewritten = file_store.rewrite_sandbox_urls("[report](sandbox:/mnt/data/report.png)")
    file_key = re.search(r"/api/files/([^)]+)", rewritten).group(1)

    with TestClient(app) as client:
        response = client.get(f"/api/files/{file_key}")

    assert response.status_code == 200
    assert response.content == b"png-bytes"
    assert response.headers["content-type"] == "image/png"


def test_files_endpoint_returns_404_for_missing_file_key():
    """Missing sandbox file keys should return 404 rather than an empty response."""
    file_store._reset_for_tests()

    with TestClient(app) as client:
        response = client.get("/api/files/missing-file-key")

    assert response.status_code == 404
