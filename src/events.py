"""Unified event model for multi-agent orchestration streaming.

All layers (orchestrator, dispatcher, foundry sub-agents) emit AgentEvent
instances through a callback or async queue. This enables real-time
visibility into the entire orchestration process.
"""

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional


class EventType(str, Enum):
    # Workflow-level
    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_COMPLETED = "workflow_completed"

    # Orchestrator reasoning
    REASONING = "reasoning"
    TOOL_DECISION = "tool_decision"
    OUTPUT = "output"

    # Task management
    TASKS_CREATED = "tasks_created"
    TASK_COMPLETED = "task_completed"

    # Sub-agent lifecycle
    AGENT_STARTED = "agent_started"
    AGENT_STREAMING = "agent_streaming"
    AGENT_COMPLETED = "agent_completed"
    AGENT_ERROR = "agent_error"

    # Document updates
    DOCUMENT_UPDATED = "document_updated"


@dataclass
class AgentEvent:
    """A single event emitted during orchestration."""

    event_type: EventType
    source: str  # e.g. "orchestrator", "flights_tool", "hotels_tool"
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


EventCallback = Optional[Callable[[AgentEvent], None]]
