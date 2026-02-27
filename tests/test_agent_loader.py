"""Unit tests for agent_loader module."""

import textwrap
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import yaml

from src.agent_loader import (
    AgentDefinition,
    parse_agent_yaml,
    create_tool_from_definition,
    load_agents,
    generate_orchestrator_instructions,
)


@pytest.fixture
def sample_agent_def():
    return AgentDefinition(
        name="test_tool",
        display_name="Test Agent",
        description="A test agent for unit testing.",
        task_description="A test task description.",
        foundry_agent_name="test-agent-v1",
    )


@pytest.fixture
def sample_yaml_dir(tmp_path):
    """Create a temp directory with sample YAML files."""
    flights = tmp_path / "flights.yaml"
    flights.write_text(yaml.dump({
        "name": "flights_tool",
        "display_name": "Flights Agent",
        "description": "Find flights.",
        "task_description": "Flight request details.",
        "foundry_agent_name": "flight-agent-v2",
    }))
    hotels = tmp_path / "hotels.yaml"
    hotels.write_text(yaml.dump({
        "name": "hotels_tool",
        "display_name": "Hotels Agent",
        "description": "Find hotels.",
        "task_description": "Hotel request details.",
        "foundry_agent_name": "hotel-agent-v2",
    }))
    return tmp_path


def test_parse_agent_yaml(tmp_path):
    """YAML file is parsed into AgentDefinition."""
    yaml_file = tmp_path / "test.yaml"
    yaml_file.write_text(yaml.dump({
        "name": "my_tool",
        "display_name": "My Agent",
        "description": "Does something.",
        "task_description": "Task details.",
        "foundry_agent_name": "my-agent-v1",
    }))

    agent_def = parse_agent_yaml(yaml_file)

    assert agent_def.name == "my_tool"
    assert agent_def.display_name == "My Agent"
    assert agent_def.foundry_agent_name == "my-agent-v1"


def test_parse_agent_yaml_missing_keys(tmp_path):
    """Missing required keys raise ValueError."""
    yaml_file = tmp_path / "bad.yaml"
    yaml_file.write_text(yaml.dump({"name": "only_name"}))

    with pytest.raises(ValueError, match="missing required keys"):
        parse_agent_yaml(yaml_file)


def test_create_tool_from_definition(sample_agent_def):
    """FunctionTool is created with correct name and description."""
    tool = create_tool_from_definition(sample_agent_def)

    assert tool.name == "test_tool"
    assert tool.description == "A test agent for unit testing."
    assert tool.func is not None


@patch("src.agent_loader.run_foundry_agent")
@patch("src.agent_loader.load_config")
def test_tool_func_invokes_foundry_agent(mock_config, mock_run, sample_agent_def):
    """Tool function calls run_foundry_agent with correct args."""
    mock_config.return_value = MagicMock(project_endpoint="https://ep")
    mock_run.return_value = "agent response"

    tool = create_tool_from_definition(sample_agent_def)
    result = tool.func(task="do something")

    mock_run.assert_called_once_with(
        project_endpoint="https://ep",
        agent_name="test-agent-v1",
        task="do something",
    )
    assert result == "agent response"


def test_load_agents_from_directory(sample_yaml_dir):
    """load_agents loads all YAML files and returns FunctionTool list."""
    tools = load_agents(sample_yaml_dir)

    assert len(tools) == 2
    names = {t.name for t in tools}
    assert names == {"flights_tool", "hotels_tool"}


def test_load_agents_empty_dir(tmp_path):
    """Empty directory returns empty list."""
    tools = load_agents(tmp_path)
    assert tools == []


def test_load_agents_nonexistent_dir(tmp_path):
    """Non-existent directory returns empty list."""
    tools = load_agents(tmp_path / "nope")
    assert tools == []


def test_generate_orchestrator_instructions(sample_yaml_dir):
    """Instructions include all loaded tool names."""
    tools = load_agents(sample_yaml_dir)
    instructions = generate_orchestrator_instructions(tools)

    assert "flights_tool" in instructions
    assert "hotels_tool" in instructions
    assert "specialist tools" in instructions
