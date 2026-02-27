"""FacilitatorTools — tools available to the Facilitator agent for scratchpad management."""

import json
import logging
from typing import Any

from agent_framework import FunctionTool
from pydantic import BaseModel, Field

from src.scratchpad.taskboard import TaskBoard
from src.scratchpad.shared_document import SharedDocument

logger = logging.getLogger(__name__)


class CreateTasksInput(BaseModel):
    tasks: str = Field(description="JSON array of task objects, each with 'text' (task description) and 'assigned_to' (specialist name, e.g. 'flights', 'hotels').")


class GetPlanStatusInput(BaseModel):
    pass  # No parameters needed


class ReadDocumentInput(BaseModel):
    pass  # No parameters needed


class ConsolidateSectionInput(BaseModel):
    day: int = Field(description="Day number (0 for general, 1+ for specific days)")
    time_slot: str = Field(description="Time slot: general, morning, afternoon, evening, or night")
    content: str = Field(description="The consolidated/merged content to replace all entries in this slot")


class ReadDocumentCleanInput(BaseModel):
    pass  # No parameters needed


class FacilitatorTools:
    """Tools for the Facilitator agent to manage the TaskBoard and SharedDocument."""

    def __init__(self, taskboard: TaskBoard, document: SharedDocument):
        self._taskboard = taskboard
        self._document = document

    def _create_tasks(self, tasks: str) -> str:
        """Parse JSON task list and create tasks on the TaskBoard."""
        task_defs = json.loads(tasks)
        created = self._taskboard.create_tasks(task_defs)
        result = []
        for t in created:
            result.append(f"[{t.id}] ({t.assigned_to}): {t.text}")
        return f"Created {len(created)} tasks:\n" + "\n".join(result)

    def _get_plan_status(self) -> str:
        """Get current status of all tasks."""
        return self._taskboard.get_status_summary()

    def _read_document(self) -> str:
        """Read the shared document with agent tags visible."""
        return self._document.render(show_agent_tags=True)

    def _consolidate_section(self, day: int, time_slot: str, content: str) -> str:
        """Consolidate/merge a document slot."""
        self._document.consolidate_section(day, time_slot, content)
        return f"Consolidated day={day} slot={time_slot}"

    def _read_document_clean(self) -> str:
        """Read the shared document without agent tags (for final output)."""
        return self._document.render(show_agent_tags=False)

    def get_tools(self) -> list[FunctionTool]:
        """Return all FacilitatorTools as FunctionTool objects."""
        return [
            FunctionTool(
                name="create_tasks",
                description="Create tasks on the TaskBoard. Each task has a text description and is assigned to a specialist agent name.",
                func=self._create_tasks,
                input_model=CreateTasksInput,
            ),
            FunctionTool(
                name="get_plan_status",
                description="Check the current status of all tasks — how many are done, which are still pending.",
                func=self._get_plan_status,
                input_model=GetPlanStatusInput,
            ),
            FunctionTool(
                name="read_document",
                description="Read the current shared document with agent tags showing who wrote each entry.",
                func=self._read_document,
                input_model=ReadDocumentInput,
            ),
            FunctionTool(
                name="consolidate_section",
                description="Merge/consolidate all entries in a document slot into a single cohesive entry. Use after reviewing specialist contributions.",
                func=self._consolidate_section,
                input_model=ConsolidateSectionInput,
            ),
            FunctionTool(
                name="read_document_clean",
                description="Read the shared document without agent tags — use this for the final review before presenting to the user.",
                func=self._read_document_clean,
                input_model=ReadDocumentCleanInput,
            ),
        ]
