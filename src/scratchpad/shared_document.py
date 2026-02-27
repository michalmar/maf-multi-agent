from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from collections import defaultdict
import logging

from src.events import AgentEvent, EventCallback, EventType

logger = logging.getLogger(__name__)

VALID_TIME_SLOTS = ("general", "morning", "afternoon", "evening", "night")


@dataclass
class SlotEntry:
    agent: str
    content: str
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class SharedDocument:
    """Slot-based collaborative workspace.

    Role separation:
    - Specialists append entries (write_section) — multiple agents can write to the same slot
    - Facilitator consolidates slots (consolidate_section) — replaces all entries with merged version
    """

    def __init__(self, event_callback: EventCallback = None):
        # day -> time_slot -> list[SlotEntry]
        self._slots: dict[int, dict[str, list[SlotEntry]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self._version: int = 0
        self._history: list[dict] = []  # version history for UI
        self._raw_contributions: str | None = None  # snapshot before first consolidation
        self._event_callback = event_callback

    @property
    def raw_contributions(self) -> str:
        """Return raw agent contributions (before consolidation).

        If no consolidation has happened yet, returns the current document.
        """
        if self._raw_contributions is not None:
            return self._raw_contributions
        return self.render(show_agent_tags=True)

    def write_section(
        self, day: int, time_slot: str, agent: str, content: str
    ) -> None:
        """Append an entry to a slot. Multiple agents can write to the same slot.
        Raises ValueError if time_slot is invalid.
        """
        if time_slot not in VALID_TIME_SLOTS:
            raise ValueError(
                f"Invalid time_slot '{time_slot}'. Must be one of {VALID_TIME_SLOTS}"
            )

        entry = SlotEntry(agent=agent, content=content)
        self._slots[day][time_slot].append(entry)
        self._version += 1
        self._history.append(
            {
                "version": self._version,
                "author": agent,
                "action": "write",
                "day": day,
                "time_slot": time_slot,
            }
        )
        logger.info(
            "📝 SharedDocument: [%s] wrote to day=%d slot=%s (v%d)",
            agent,
            day,
            time_slot,
            self._version,
        )
        self._emit_update()

    def consolidate_section(
        self,
        day: int,
        time_slot: str,
        content: str,
        author: str = "facilitator",
    ) -> None:
        """Replace all entries in a slot with a single consolidated version.
        Used by the Facilitator to merge multiple specialist contributions.
        """
        # Snapshot raw agent contributions before the first consolidation
        if self._raw_contributions is None:
            self._raw_contributions = self.render(show_agent_tags=True)
        if time_slot not in VALID_TIME_SLOTS:
            raise ValueError(
                f"Invalid time_slot '{time_slot}'. Must be one of {VALID_TIME_SLOTS}"
            )

        self._slots[day][time_slot] = [SlotEntry(agent=author, content=content)]
        self._version += 1
        self._history.append(
            {
                "version": self._version,
                "author": author,
                "action": "consolidate",
                "day": day,
                "time_slot": time_slot,
            }
        )
        logger.info(
            "🔀 SharedDocument: consolidated day=%d slot=%s (v%d)",
            day,
            time_slot,
            self._version,
        )
        self._emit_update()

    def render(self, show_agent_tags: bool = True) -> str:
        """Render the document as a readable string.

        If show_agent_tags=True, entries are prefixed with [agent_name].
        If False, a clean version is returned (for final output to user).
        """
        if not self._slots:
            return "(empty document)"

        lines = []
        for day in sorted(self._slots.keys()):
            day_label = "General" if day == 0 else f"Day {day}"
            lines.append(f"## {day_label}")

            day_slots = self._slots[day]
            for slot_name in VALID_TIME_SLOTS:
                if slot_name not in day_slots or not day_slots[slot_name]:
                    continue

                if slot_name != "general":
                    lines.append(f"### {slot_name.capitalize()}")

                for entry in day_slots[slot_name]:
                    if show_agent_tags:
                        lines.append(f"[{entry.agent}] {entry.content}")
                    else:
                        lines.append(entry.content)

            lines.append("")  # blank line between days

        return "\n".join(lines).strip()

    @property
    def version(self) -> int:
        return self._version

    @property
    def history(self) -> list[dict]:
        return list(self._history)

    def _emit_update(self) -> None:
        if self._event_callback:
            self._event_callback(AgentEvent(
                event_type=EventType.DOCUMENT_UPDATED,
                source="document",
                data={
                    "version": self._version,
                    "content": self.render(show_agent_tags=True),
                    "history": self._history[-1] if self._history else {},
                },
            ))
