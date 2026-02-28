"""CLI entry point for the multi-agent travel planner.

Usage:
    python -m src.main "Plan me a trip to London from Prague"
    python -m src.main                    # Uses default sample query
    python -m src.main --mode simple ...  # Use simple orchestrator (no scratchpad)
    python -m src.main --mode scratchpad  # Use scratchpad workflow (default)
"""

import asyncio
import logging
import os
import sys
from datetime import datetime

from dotenv import load_dotenv

from src.events import AgentEvent, EventType


# Agent display names and emoji prefixes
AGENT_ICONS = {
    "flights_tool": "✈️ ",
    "hotels_tool": "🏨",
    "orchestrator": "🤖",
    "websearch_tool": "🔍"
}


def _render_event(event: AgentEvent) -> None:
    """Render a single AgentEvent to the terminal."""
    icon = AGENT_ICONS.get(event.source, "⚡")
    ts = datetime.fromtimestamp(event.timestamp).strftime("%H:%M:%S")

    if event.event_type == EventType.WORKFLOW_STARTED:
        print(f"\n{ts} 🎯 Workflow started")

    elif event.event_type == EventType.REASONING:
        text = event.data.get("text", "")
        iteration = event.data.get("iteration", "?")
        print(f"{ts} 🧠 [iter #{iteration}] {text[:120]}{'...' if len(text) > 120 else ''}")

    elif event.event_type == EventType.TOOL_DECISION:
        tool = event.data.get("tool", "?")
        iteration = event.data.get("iteration", "?")
        print(f"{ts} 🔧 [iter #{iteration}] → {tool}")

    elif event.event_type == EventType.AGENT_STARTED:
        agent = event.data.get("agent_name", "?")
        print(f"{ts} {icon} [{event.source}] Agent started: {agent}")

    elif event.event_type == EventType.AGENT_STREAMING:
        delta = event.data.get("delta", "")
        # Print streaming deltas inline (no newline, flush immediately)
        sys.stdout.write(delta)
        sys.stdout.flush()
        return  # skip the implicit newline

    elif event.event_type == EventType.AGENT_COMPLETED:
        length = event.data.get("length", 0)
        elapsed = event.data.get("elapsed", 0)
        # Ensure we're on a new line after streaming deltas
        print(f"\n{ts} {icon} [{event.source}] ✅ Completed ({length} chars, {elapsed:.1f}s)")

    elif event.event_type == EventType.AGENT_ERROR:
        error = event.data.get("error", "?")
        print(f"{ts} {icon} [{event.source}] ❌ Error: {error}")

    elif event.event_type == EventType.OUTPUT:
        text = event.data.get("text", "")
        print(f"{ts} 📝 Final output ({len(text)} chars)")

    elif event.event_type == EventType.WORKFLOW_COMPLETED:
        elapsed = event.data.get("elapsed", 0)
        print(f"{ts} 🏁 Workflow completed ({elapsed:.1f}s)")


def setup_logging() -> None:
    """Configure logging for the application."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    for noisy_logger in [
        "azure.core.pipeline.policies.http_logging_policy",
        "azure.identity",
        "httpx",
        "openai",
    ]:
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)


# DEFAULT_QUERY = (
#     "I'm in Prague and want a 3-day trip to London next week. "
#     "Find reasonable flights and a mid-range hotel near good public transport."
#     "Also, give me a current weather forecast for London during that time, and any COVID-19 restrictions I should be aware of."
#     "Do not ask follow up questions, use best effort judgment."
# )

DEFAULT_QUERY = "What vibration RMS threshold requires a planned intervention for the offshore centrifugal compressor?"

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")


def _save_markdown(run_id: str, filename: str, title: str, content: str, query: str, mode: str) -> str:
    """Save content as a markdown file in the output directory."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    header = (
        f"# {title}\n\n"
        f"- **Run ID:** `{run_id}`\n"
        f"- **Timestamp:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"- **Mode:** {mode}\n"
        f"- **Query:** {query}\n\n"
        f"---\n\n"
    )
    filepath = os.path.join(OUTPUT_DIR, f"{run_id}-{filename}.md")
    with open(filepath, "w") as f:
        f.write(header + content + "\n")
    return filepath


async def main() -> None:
    load_dotenv()
    setup_logging()

    args = sys.argv[1:]
    mode = "scratchpad"
    if "--mode" in args:
        idx = args.index("--mode")
        if idx + 1 < len(args):
            mode = args[idx + 1]
            args = args[:idx] + args[idx + 2:]

    query = " ".join(args) if args else DEFAULT_QUERY

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")

    print(f"🧳 Query: {query}\n")
    print(f"📋 Mode: {mode}\n")
    print(f"🆔 Run ID: {run_id}\n")
    print("⏳ Running...\n")

    if mode == "simple":
        from src.orchestrator import run_query
        result = await run_query(query)
        document_md = None
    else:
        from src.scratchpad.workflow import run_scratchpad_workflow
        result, document_md = await run_scratchpad_workflow(
            query, event_callback=_render_event,
        )

    print("=" * 60)
    print("✅ Travel Plan")
    print("=" * 60)
    print(result)

    # Save final result
    result_path = _save_markdown(run_id, "result", "Travel Plan — Final Result", result, query, mode)
    print(f"\n📄 Result saved to: {result_path}")

    # Save shared document (scratchpad mode only)
    if document_md:
        doc_path = _save_markdown(run_id, "document", "Shared Document (Agent Contributions)", document_md, query, mode)
        print(f"📋 Document saved to: {doc_path}")


if __name__ == "__main__":
    asyncio.run(main())
