import json
import logging

import pytest
from agent_framework import FunctionTool

from src.scratchpad.specialist_tools import SpecialistTools
from src.scratchpad.shared_document import SharedDocument
from src.scratchpad.taskboard import TaskBoard


@pytest.fixture
def board():
    tb = TaskBoard()
    tb.create_tasks([
        {"text": "Find flights to Paris", "assigned_to": "flights"},
        {"text": "Find hotels in Paris", "assigned_to": "hotels"},
        {"text": "Plan dining options", "assigned_to": "dining"},
    ])
    return tb


@pytest.fixture
def doc():
    return SharedDocument()


@pytest.fixture
def tools(board, doc):
    return SpecialistTools(
        agent_name="flights",
        assigned_task_ids=[1],
        taskboard=board,
        document=doc,
    )


# ── read_tasks ────────────────────────────────────────────────


def test_read_tasks(tools):
    result = tools._read_tasks(task_ids=json.dumps([1]))
    assert "[1]" in result
    assert "flights" in result
    assert "Find flights to Paris" in result
    assert "⏳ pending" in result


def test_read_tasks_empty(tools):
    result = tools._read_tasks(task_ids=json.dumps([99]))
    assert result == "No tasks found for the given IDs."


# ── complete_task ─────────────────────────────────────────────


def test_complete_task(tools, board):
    result = tools._complete_task(task_id=1)
    assert "Task 1 marked as completed" in result
    assert board.read_tasks([1])[0].finished is True


def test_complete_task_not_found(tools):
    result = tools._complete_task(task_id=99)
    assert "Error:" in result
    assert "not found" in result


def test_complete_task_not_assigned_warns(tools, board, caplog):
    with caplog.at_level(logging.WARNING):
        result = tools._complete_task(task_id=2)
    assert "Task 2 marked as completed" in result
    assert board.read_tasks([2])[0].finished is True
    assert "not in its assigned set" in caplog.text


# ── read_document ─────────────────────────────────────────────


def test_read_document(tools, doc):
    doc.write_section(day=1, time_slot="morning", agent="flights", content="Fly at 9am")
    result = tools._read_document()
    assert "[flights]" in result
    assert "Fly at 9am" in result


# ── write_section ─────────────────────────────────────────────


def test_write_section(tools, doc):
    result = tools._write_section(day=1, time_slot="morning", content="Take the 8am flight")
    assert "Written to day=1 slot=morning" in result
    rendered = doc.render(show_agent_tags=True)
    assert "[flights]" in rendered
    assert "Take the 8am flight" in rendered


def test_write_section_invalid_slot(tools):
    result = tools._write_section(day=1, time_slot="brunch", content="Invalid")
    assert "Error:" in result
    assert "Invalid time_slot" in result


# ── get_tools ─────────────────────────────────────────────────


def test_get_tools_returns_function_tools(tools):
    tool_list = tools.get_tools()
    assert len(tool_list) == 4
    assert all(isinstance(t, FunctionTool) for t in tool_list)
    names = {t.name for t in tool_list}
    assert names == {"read_tasks", "complete_task", "read_document", "write_section"}
