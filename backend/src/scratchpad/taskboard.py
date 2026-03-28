from dataclasses import dataclass, field
from typing import Optional
import logging
import threading

from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)


@dataclass
class Task:
    id: int
    text: str
    assigned_to: str
    finished: bool = False


class TaskBoard:
    """In-memory task list for multi-agent coordination.

    Role separation:
    - Facilitator creates tasks (via create_tasks)
    - Specialists read and complete tasks (via read_tasks / complete_task)

    Thread-safe: all mutations are protected by a lock since dispatch
    tools may run concurrently from separate threads.
    """

    def __init__(self, event_callback: EventCallback = None):
        self._tasks: list[Task] = []
        self._next_id: int = 1
        self._lock = threading.Lock()
        self._event_callback = event_callback

    def create_tasks(self, task_defs: list[dict]) -> list[Task]:
        """Create tasks from a list of dicts with keys: text, assigned_to.
        Returns the created Task objects. Each gets an auto-incremented ID.
        """
        with self._lock:
            created = []
            for td in task_defs:
                task = Task(
                    id=self._next_id,
                    text=td["text"],
                    assigned_to=td["assigned_to"],
                )
                self._tasks.append(task)
                self._next_id += 1
                created.append(task)
            snapshot = self._task_snapshot()
        logger.info(
            "📋 TaskBoard: created %d tasks (IDs %s)",
            len(created),
            [t.id for t in created],
        )
        self._log_all_tasks()
        if self._event_callback:
            self._event_callback(AgentEvent(
                event_type=EventType.TASKS_CREATED,
                source="taskboard",
                data={"tasks": snapshot},
            ))
        return created

    def get_all_tasks(self) -> list[Task]:
        """Return all tasks."""
        with self._lock:
            return list(self._tasks)

    def read_tasks(self, task_ids: list[int]) -> list[Task]:
        """Read specific tasks by ID."""
        id_set = set(task_ids)
        with self._lock:
            return [t for t in self._tasks if t.id in id_set]

    def complete_task(self, task_id: int) -> Task:
        """Mark a task as finished. Returns the updated task.
        Idempotent — calling on an already-finished task is a no-op.
        Raises ValueError if task not found.
        """
        with self._lock:
            for task in self._tasks:
                if task.id == task_id:
                    if task.finished:
                        return task  # already done — no duplicate event
                    task.finished = True
                    snapshot = self._task_snapshot()
                    break
            else:
                raise ValueError(f"Task {task_id} not found")

        logger.info("✅ TaskBoard: task %d completed", task_id)
        self._log_all_tasks()
        if self._event_callback:
            self._event_callback(AgentEvent(
                event_type=EventType.TASK_COMPLETED,
                source="taskboard",
                data={"task_id": task_id, "tasks": snapshot},
            ))
        return task

    def get_status_summary(self) -> str:
        """Return a human-readable status summary."""
        with self._lock:
            total = len(self._tasks)
            done = sum(1 for t in self._tasks if t.finished)
            pending = [t for t in self._tasks if not t.finished]
        lines = [f"{done}/{total} tasks completed."]
        if pending:
            lines.append("Pending tasks:")
            for t in pending:
                lines.append(f"  - [{t.id}] ({t.assigned_to}): {t.text}")
        return "\n".join(lines)

    def _task_snapshot(self) -> list[dict]:
        """Return a serialisable snapshot of all tasks. Caller must hold _lock."""
        return [
            {"id": t.id, "text": t.text, "assigned_to": t.assigned_to, "finished": t.finished}
            for t in self._tasks
        ]

    def _log_all_tasks(self) -> None:
        """Log the current status of all tasks."""
        total = len(self._tasks)
        done = sum(1 for t in self._tasks if t.finished)
        logger.info("┌─── TaskBoard Status (%d/%d done) ───", done, total)
        for t in self._tasks:
            icon = "✅" if t.finished else "⏳"
            logger.info("│ %s [%d] (%s): %s", icon, t.id, t.assigned_to, t.text)
        logger.info("└" + "─" * 40)
