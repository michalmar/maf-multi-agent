"""Unit tests for orchestrator module."""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
import yaml

from src.orchestrator import create_orchestrator


@pytest.fixture
def agents_dir(tmp_path):
    """Create a temp agents directory with one test agent."""
    agent = tmp_path / "test.yaml"
    agent.write_text(yaml.dump({
        "name": "test_tool",
        "display_name": "Test Agent",
        "description": "A test agent.",
        "task_description": "A test task.",
        "foundry_agent_name": "test-agent-v1",
    }))
    return tmp_path


@patch("src.orchestrator.AzureOpenAIResponsesClient")
@patch("src.orchestrator.AzureCliCredential")
def test_create_orchestrator(mock_cred, mock_client_cls, agents_dir):
    """create_orchestrator returns an agent with dynamically loaded tools."""
    mock_client = MagicMock()
    mock_agent = MagicMock()
    mock_client.as_agent.return_value = mock_agent
    mock_client_cls.return_value = mock_client

    agent = create_orchestrator(agents_dir=str(agents_dir))

    assert agent is mock_agent
    mock_client.as_agent.assert_called_once()
    call_kwargs = mock_client.as_agent.call_args.kwargs
    assert call_kwargs["name"] == "travel-orchestrator"
    assert len(call_kwargs["tools"]) == 1
    assert call_kwargs["tools"][0].name == "test_tool"
    assert "test_tool" in call_kwargs["instructions"]


@patch("src.orchestrator.AzureOpenAIResponsesClient")
@patch("src.orchestrator.AzureCliCredential")
def test_create_orchestrator_with_custom_params(mock_cred, mock_client_cls, agents_dir):
    """create_orchestrator accepts optional endpoint and deployment_name."""
    mock_client = MagicMock()
    mock_client.as_agent.return_value = MagicMock()
    mock_client_cls.return_value = mock_client

    create_orchestrator(
        project_endpoint="https://custom.services.ai.azure.com/api/projects/test",
        deployment_name="gpt-4o-mini",
        agents_dir=str(agents_dir),
    )

    mock_client_cls.assert_called_once_with(
        credential=mock_cred.return_value,
        project_endpoint="https://custom.services.ai.azure.com/api/projects/test",
        deployment_name="gpt-4o-mini",
    )


@patch("src.orchestrator.AzureOpenAIResponsesClient")
@patch("src.orchestrator.AzureCliCredential")
def test_create_orchestrator_no_agents_raises(mock_cred, mock_client_cls, tmp_path):
    """create_orchestrator raises if no agent YAML files are found."""
    with pytest.raises(RuntimeError, match="No agent tools loaded"):
        create_orchestrator(agents_dir=str(tmp_path))
