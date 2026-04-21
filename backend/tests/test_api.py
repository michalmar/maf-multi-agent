"""Tests for API helpers and result fallback behavior."""

from fastapi.testclient import TestClient

from src.api import app, _build_session_snapshot


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
    def __init__(self, snapshot: dict | None):
        self.snapshot = snapshot

    async def get_session(self, user_dir: str, run_id: str) -> dict | None:
        assert user_dir == "user@example.com"
        assert run_id == "run-123"
        return self.snapshot

    async def find_session_any_user(self, run_id: str):
        raise AssertionError("Super-user path should not be used in this test")


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
