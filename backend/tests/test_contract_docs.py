from pathlib import Path

from src.events import EventType


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_event_contract_mentions_every_event_type():
    contract = (REPO_ROOT / "docs" / "CONTRACT-events.md").read_text()

    missing = [event_type.value for event_type in EventType if event_type.value not in contract]

    assert missing == []


def test_runtime_contract_docs_exist():
    docs_dir = REPO_ROOT / "docs"

    assert (docs_dir / "CONTRACT-orchestrator.md").is_file()
    assert (docs_dir / "CONTRACT-specialist.md").is_file()
    assert (docs_dir / "CONTRACT-events.md").is_file()
