"""Unit tests for foundry_client module."""

from unittest.mock import patch, AsyncMock, MagicMock

import pytest

from src.foundry_client import run_foundry_agent, FoundryAgentError


def test_run_foundry_agent_success():
    """Successful agent invocation returns agent text."""
    mock_response = MagicMock()
    mock_response.output_text = "Flight options: A, B, C"

    with patch("src.foundry_client._run_agent_async", new_callable=lambda: lambda *a: AsyncMock(return_value=("Flight options: A, B, C", None))) as mock_async:
        # Patch the entire async function to return directly
        pass

    # Simpler: patch at the thread level
    with patch("src.foundry_client._run_agent_async", new=AsyncMock(return_value=("Flight options: A, B, C", None))):
        result = run_foundry_agent("https://test.endpoint", "flight-agent-v2", "Find flights")

    assert result == "Flight options: A, B, C"


def test_run_foundry_agent_failed_run():
    """Failed run raises FoundryAgentError."""
    with patch("src.foundry_client._run_agent_async", new=AsyncMock(side_effect=RuntimeError("agent failed"))):
        with pytest.raises(FoundryAgentError, match="run failed"):
            run_foundry_agent("https://test.endpoint", "flight-agent-v2", "bad request")


def test_run_foundry_agent_returns_text():
    """Response text is returned as-is."""
    with patch("src.foundry_client._run_agent_async", new=AsyncMock(return_value=("Hotel B: Covent Garden", {"input_tokens": 50, "output_tokens": 20, "total_tokens": 70}))):
        result = run_foundry_agent("https://test.endpoint", "hotel-agent-v2", "Find hotels")

    assert result == "Hotel B: Covent Garden"
