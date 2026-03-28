import pytest
from src.scratchpad.taskboard import Task, TaskBoard


@pytest.fixture
def board():
    return TaskBoard()


@pytest.fixture
def sample_defs():
    return [
        {"text": "Write intro", "assigned_to": "writer"},
        {"text": "Review code", "assigned_to": "reviewer"},
    ]


def test_create_tasks(board, sample_defs):
    created = board.create_tasks(sample_defs)
    assert len(created) == 2
    assert created[0].id == 1
    assert created[1].id == 2
    assert created[0].text == "Write intro"
    assert created[0].assigned_to == "writer"
    assert created[1].text == "Review code"
    assert created[1].assigned_to == "reviewer"
    assert all(not t.finished for t in created)


def test_get_all_tasks(board, sample_defs):
    board.create_tasks(sample_defs)
    all_tasks = board.get_all_tasks()
    assert len(all_tasks) == 2
    assert all_tasks[0].id == 1
    assert all_tasks[1].id == 2


def test_read_tasks_by_id(board, sample_defs):
    board.create_tasks(sample_defs)
    result = board.read_tasks([2])
    assert len(result) == 1
    assert result[0].id == 2
    assert result[0].text == "Review code"


def test_read_tasks_missing_ids(board, sample_defs):
    board.create_tasks(sample_defs)
    result = board.read_tasks([99, 100])
    assert result == []


def test_complete_task(board, sample_defs):
    board.create_tasks(sample_defs)
    completed = board.complete_task(1)
    assert completed.finished is True
    assert completed.id == 1
    # Verify via get_all_tasks
    all_tasks = board.get_all_tasks()
    assert all_tasks[0].finished is True
    assert all_tasks[1].finished is False


def test_complete_task_not_found(board):
    with pytest.raises(ValueError, match="Task 42 not found"):
        board.complete_task(42)


def test_get_status_summary(board, sample_defs):
    board.create_tasks(sample_defs)
    board.complete_task(1)
    summary = board.get_status_summary()
    assert "1/2 tasks completed." in summary
    assert "Pending tasks:" in summary
    assert "[2] (reviewer): Review code" in summary
    assert "writer" not in summary  # task 1 is done, shouldn't be listed


def test_create_tasks_increments_ids(board):
    first_batch = board.create_tasks([
        {"text": "Task A", "assigned_to": "alpha"},
    ])
    second_batch = board.create_tasks([
        {"text": "Task B", "assigned_to": "beta"},
        {"text": "Task C", "assigned_to": "gamma"},
    ])
    assert first_batch[0].id == 1
    assert second_batch[0].id == 2
    assert second_batch[1].id == 3
    assert len(board.get_all_tasks()) == 3
