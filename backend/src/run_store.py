"""Thread-safe run state management with TTL-based eviction."""

import asyncio
import time
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Default TTL: 1 hour
DEFAULT_RUN_TTL_SECONDS = 3600


@dataclass
class RunState:
    """State for a single run."""
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    result: dict | None = None
    streaming: bool = False
    user_dir: str = ""
    created_at: float = field(default_factory=time.monotonic)


class RunStore:
    """Manages run state with automatic TTL-based eviction."""

    def __init__(self, ttl_seconds: int = DEFAULT_RUN_TTL_SECONDS):
        self._runs: dict[str, RunState] = {}
        self._ttl = ttl_seconds

    def create(self, run_id: str, user_dir: str = "") -> RunState:
        self._evict_expired()
        state = RunState(user_dir=user_dir)
        self._runs[run_id] = state
        return state

    def get(self, run_id: str) -> RunState | None:
        return self._runs.get(run_id)

    def remove(self, run_id: str) -> None:
        self._runs.pop(run_id, None)

    def set_result(self, run_id: str, result: dict) -> None:
        state = self._runs.get(run_id)
        if state:
            state.result = result

    def get_result(self, run_id: str) -> dict | None:
        state = self._runs.get(run_id)
        return state.result if state else None

    def is_streaming(self, run_id: str) -> bool:
        state = self._runs.get(run_id)
        return state.streaming if state else False

    def set_streaming(self, run_id: str, value: bool) -> None:
        state = self._runs.get(run_id)
        if state:
            state.streaming = value

    def _evict_expired(self) -> None:
        now = time.monotonic()
        expired = [
            rid for rid, state in self._runs.items()
            if (now - state.created_at) > self._ttl and not state.streaming
        ]
        for rid in expired:
            del self._runs[rid]
            logger.debug("Evicted expired run %s", rid)
