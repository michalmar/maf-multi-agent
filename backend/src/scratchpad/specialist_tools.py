"""SpecialistTools — tools available to specialist agents for scratchpad interaction."""

import json
import logging
from typing import Any

from agent_framework import FunctionTool
from pydantic import BaseModel, Field

from src.scratchpad.taskboard import TaskBoard
from src.scratchpad.shared_document import SharedDocument

logger = logging.getLogger(__name__)


class ReadTasksInput(BaseModel):
    task_ids: str = Field(description="JSON array of task ID integers to read, e.g. '[1, 2]'")


class CompleteTaskInput(BaseModel):
    task_id: int = Field(description="The ID of the task to mark as completed")


class ReadDocumentInput(BaseModel):
    pass


class WriteSectionInput(BaseModel):
    day: int = Field(description="Day number (0 for general info, 1+ for specific days)")
    time_slot: str = Field(description="Time slot: general, morning, afternoon, evening, or night")
    content: str = Field(description="The content to write to this section")


class SpecialistTools:
    """Tools for specialist agents to interact with TaskBoard and SharedDocument.

    Each instance is bound to a specific agent name and set of assigned task IDs.
    The agent_name is used as the author tag when writing to the document.
    assigned_task_ids acts as a guardrail — if the agent tries to complete
    a task not assigned to it, it logs a warning and auto-corrects.
    """

    def __init__(
        self,
        agent_name: str,
        assigned_task_ids: list[int],
        taskboard: TaskBoard,
        document: SharedDocument,
    ):
        self._agent_name = agent_name
        self._assigned_task_ids = set(assigned_task_ids)
        self._taskboard = taskboard
        self._document = document

    def _read_tasks(self, task_ids: str) -> str:
        """Read specific tasks from the TaskBoard."""
        ids = json.loads(task_ids)
        tasks = self._taskboard.read_tasks(ids)
        if not tasks:
            return "No tasks found for the given IDs."
        lines = []
        for t in tasks:
            status = "✅ done" if t.finished else "⏳ pending"
            lines.append(f"[{t.id}] ({t.assigned_to}, {status}): {t.text}")
        return "\n".join(lines)

    def _complete_task(self, task_id: int) -> str:
        """Mark a task as completed. Auto-corrects if task_id not in assigned set."""
        if task_id not in self._assigned_task_ids:
            logger.warning(
                "⚠️ Agent '%s' tried to complete task %d which is not in its assigned set %s",
                self._agent_name, task_id, self._assigned_task_ids,
            )
        try:
            task = self._taskboard.complete_task(task_id)
            return f"Task {task_id} marked as completed: {task.text}"
        except ValueError as e:
            return f"Error: {e}"

    def _read_document(self) -> str:
        """Read the current shared document."""
        return self._document.render(show_agent_tags=True)

    def _write_section(self, day: int, time_slot: str, content: str) -> str:
        """Write content to a section of the shared document."""
        try:
            self._document.write_section(
                day=day,
                time_slot=time_slot,
                agent=self._agent_name,
                content=content,
            )
            return f"Written to day={day} slot={time_slot}"
        except ValueError as e:
            return f"Error: {e}"

    def get_tools(self) -> list[FunctionTool]:
        """Return all SpecialistTools as FunctionTool objects."""
        return [
            FunctionTool(
                name="read_tasks",
                description="Read your assigned tasks from the TaskBoard to understand what work needs to be done.",
                func=self._read_tasks,
                input_model=ReadTasksInput,
            ),
            FunctionTool(
                name="complete_task",
                description="Mark a task as completed after you have finished working on it and written results to the document.",
                func=self._complete_task,
                input_model=CompleteTaskInput,
            ),
            FunctionTool(
                name="read_document",
                description="Read the current shared document to see what other specialists have written.",
                func=self._read_document,
                input_model=ReadDocumentInput,
            ),
            FunctionTool(
                name="write_section",
                description="Write your findings/recommendations to a section of the shared document. Use day=0 for general info, day=1+ for specific days.",
                func=self._write_section,
                input_model=WriteSectionInput,
            ),
        ]
