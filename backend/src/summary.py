"""Lightweight event summary generation using a fast LLM (gpt-4.1-nano).

Generates concise one-sentence summaries for select event types to make the
activity feed more human-readable. Designed to be called inline before event
emission — adds ~100-300ms latency per summarized event but never blocks the
main workflow (agents run in separate threads).
"""

import logging
from typing import Optional

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
from openai import OpenAI

from src.config import load_config
from src.events import AgentEvent, EventType

logger = logging.getLogger(__name__)

# Event types that benefit from LLM-generated summaries
SUMMARIZABLE_EVENTS = frozenset({
    EventType.REASONING,
    EventType.TOOL_DECISION,
    EventType.WORKFLOW_STARTED,
    EventType.OUTPUT,
})

_SYSTEM_PROMPT = (
    "You are a concise technical summarizer for a multi-agent orchestration system. "
    "Generate a single short sentence (max 20 words) summarizing the event. "
    "Be specific — mention tool names, agent names, or key decisions. "
    "Do NOT use quotes or markdown or underscores. Reply with only the summary sentence."
)


def _build_user_prompt(event: AgentEvent) -> str:
    """Build the user prompt from event data."""
    event_type = event.event_type.value
    source = event.source
    data = event.data

    if event.event_type == EventType.REASONING:
        text = data.get("text", "")
        return f"Event: {event_type} from {source}\nReasoning text: {text}"

    if event.event_type == EventType.TOOL_DECISION:
        tool = data.get("tool", "unknown")
        args = data.get("arguments", "")
        return f"Event: {event_type} from {source}\nTool: {tool}\nArguments: {args}"

    if event.event_type == EventType.WORKFLOW_STARTED:
        query = data.get("query", "")
        return f"Event: {event_type}\nUser query: {query}"

    if event.event_type == EventType.OUTPUT:
        text = data.get("text", "")
        return f"Event: final output from {source}\nOutput text: {text[:500]}"

    return f"Event: {event_type} from {source}\nData: {data}"


class SummaryService:
    """Manages an OpenAI client (via AI Foundry project) for generating event summaries.

    Credentials and project client are stored for reuse to avoid connection pool leaks.
    """

    def __init__(self):
        config = load_config()
        self._deployment = config.azure_openai_summary_deployment_name
        self._project_endpoint = config.project_endpoint
        self._credential: Optional[DefaultAzureCredential] = None
        self._project_client: Optional[AIProjectClient] = None
        self._client: Optional[OpenAI] = None

    def _get_client(self) -> OpenAI:
        if self._client is None:
            self._credential = DefaultAzureCredential()
            self._project_client = AIProjectClient(
                endpoint=self._project_endpoint,
                credential=self._credential,
            )
            self._client = self._project_client.get_openai_client()
        return self._client

    def close(self) -> None:
        """Release underlying HTTP connections."""
        if self._project_client is not None:
            try:
                self._project_client.close()
            except Exception:
                pass
            self._project_client = None
        if self._credential is not None:
            try:
                self._credential.close()
            except Exception:
                pass
            self._credential = None
        self._client = None

    def generate_summary(self, event: AgentEvent) -> str:
        """Generate a one-sentence summary for an event. Returns empty string on failure."""
        if event.event_type not in SUMMARIZABLE_EVENTS:
            return ""

        try:
            client = self._get_client()
            response = client.responses.create(
                model=self._deployment,
                instructions=_SYSTEM_PROMPT,
                input=_build_user_prompt(event),
                max_output_tokens=60,
                temperature=0.2,
            )
            summary = (response.output_text or "").strip()
            logger.debug("Summary generated for %s: %s", event.event_type.value, summary)
            return summary
        except Exception as e:
            logger.warning("Summary generation failed for %s: %s", event.event_type.value, e)
            return ""

    def generate_summary_safe(self, event: AgentEvent) -> str:
        """Thread-safe wrapper — works from any thread context."""
        return self.generate_summary(event)
