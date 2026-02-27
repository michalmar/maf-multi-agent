import json

import pytest
from agent_framework import FunctionTool

from src.scratchpad.facilitator_tools import FacilitatorTools
from src.scratchpad.shared_document import SharedDocument
from src.scratchpad.taskboard import TaskBoard


@pytest.fixture
def board():
    return TaskBoard()


@pytest.fixture
def doc():
    return SharedDocument()


@pytest.fixture
def tools(board, doc):
    return FacilitatorTools(board, doc)


# ── create_tasks ──────────────────────────────────────────────


def test_create_tasks(tools, board):
    task_json = json.dumps([
        {"text": "Find flights", "assigned_to": "flights"},
        {"text": "Find hotels", "assigned_to": "hotels"},
    ])
    result = tools._create_tasks(tasks=task_json)
    assert "Created 2 tasks" in result
    assert "(flights): Find flights" in result
    assert "(hotels): Find hotels" in result
    assert len(board.get_all_tasks()) == 2


def test_create_tasks_invalid_json(tools):
    with pytest.raises(json.JSONDecodeError):
        tools._create_tasks(tasks="not valid json")


# ── get_plan_status ───────────────────────────────────────────


def test_get_plan_status(tools, board):
    board.create_tasks([{"text": "Task A", "assigned_to": "alpha"}])
    result = tools._get_plan_status()
    assert "0/1 tasks completed" in result
    assert "Task A" in result


# ── read_document ─────────────────────────────────────────────


def test_read_document(tools, doc):
    doc.write_section(day=1, time_slot="morning", agent="flights", content="Fly at 9am")
    result = tools._read_document()
    assert "[flights]" in result
    assert "Fly at 9am" in result


# ── consolidate_section ───────────────────────────────────────


def test_consolidate_section(tools, doc):
    doc.write_section(day=1, time_slot="morning", agent="flights", content="Option A")
    doc.write_section(day=1, time_slot="morning", agent="hotels", content="Option B")
    result = tools._consolidate_section(day=1, time_slot="morning", content="Merged plan")
    assert "Consolidated day=1 slot=morning" in result
    rendered = doc.render(show_agent_tags=False)
    assert "Merged plan" in rendered
    assert "Option A" not in rendered
    assert "Option B" not in rendered


# ── read_document_clean ───────────────────────────────────────


def test_read_document_clean(tools, doc):
    doc.write_section(day=1, time_slot="evening", agent="dining", content="Dinner at 7pm")
    result = tools._read_document_clean()
    assert "Dinner at 7pm" in result
    assert "[dining]" not in result


# ── get_tools ─────────────────────────────────────────────────


def test_get_tools_returns_function_tools(tools):
    tool_list = tools.get_tools()
    assert len(tool_list) == 5
    assert all(isinstance(t, FunctionTool) for t in tool_list)
    names = {t.name for t in tool_list}
    assert names == {"create_tasks", "get_plan_status", "read_document", "consolidate_section", "read_document_clean"}
