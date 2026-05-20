"""Unit tests for observability setup."""

import pytest

from src.observability import _setup_foundry_monitor


class _AsyncContext:
    def __init__(self, value=None, **kwargs):
        self.value = value or self
        self.kwargs = kwargs

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_foundry_monitor_disables_live_metrics_by_default(monkeypatch):
    """Live Metrics should be opt-in to avoid noisy QuickPulse errors in local runs."""
    configure_calls = []

    class FakeAzureAIClient(_AsyncContext):
        async def configure_azure_monitor(self, **kwargs):
            configure_calls.append(kwargs)

    monkeypatch.setattr("azure.identity.aio.DefaultAzureCredential", _AsyncContext)
    monkeypatch.setattr("azure.ai.projects.aio.AIProjectClient", _AsyncContext)
    monkeypatch.setattr("agent_framework.azure.AzureAIClient", FakeAzureAIClient)
    monkeypatch.setattr("agent_framework.observability.enable_instrumentation", lambda **kwargs: None)

    assert await _setup_foundry_monitor("https://project.example", enable_sensitive=False)

    assert configure_calls == [{"enable_live_metrics": False}]


@pytest.mark.asyncio
async def test_foundry_monitor_can_enable_live_metrics(monkeypatch):
    """Live Metrics remains available when explicitly enabled."""
    configure_calls = []

    class FakeAzureAIClient(_AsyncContext):
        async def configure_azure_monitor(self, **kwargs):
            configure_calls.append(kwargs)

    monkeypatch.setattr("azure.identity.aio.DefaultAzureCredential", _AsyncContext)
    monkeypatch.setattr("azure.ai.projects.aio.AIProjectClient", _AsyncContext)
    monkeypatch.setattr("agent_framework.azure.AzureAIClient", FakeAzureAIClient)
    monkeypatch.setattr("agent_framework.observability.enable_instrumentation", lambda **kwargs: None)

    assert await _setup_foundry_monitor(
        "https://project.example",
        enable_sensitive=False,
        enable_live_metrics=True,
    )

    assert configure_calls == [{"enable_live_metrics": True}]
