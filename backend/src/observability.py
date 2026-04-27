"""Azure AI Foundry observability setup for the multi-agent orchestrator.

Configures OpenTelemetry tracing, metrics, and logs so that all MAF agent
spans (invoke_agent, chat, execute_tool) are exported to Application Insights
linked to the Foundry project.

Two setup paths are supported:
  1. Foundry-native — uses AzureAIClient.configure_azure_monitor() which
     auto-retrieves the App Insights connection string from the project.
  2. Fallback — uses agent_framework.observability.configure_otel_providers()
     which reads standard OTEL_EXPORTER_OTLP_* env vars or enables console
     exporters.

Usage:
    from src.observability import setup_observability
    await setup_observability()   # call once at startup
"""

import logging
import os

logger = logging.getLogger(__name__)

_initialized = False


async def setup_observability() -> None:
    """Configure observability for the orchestrator agent.

    Tries the Foundry-native path first (auto-retrieves App Insights
    connection string from the project). Falls back to standard
    OpenTelemetry configuration via environment variables.

    This function is idempotent — subsequent calls are no-ops.
    """
    global _initialized
    if _initialized:
        logger.debug("Observability already initialized, skipping.")
        return

    from src.config import get_config

    if not get_config().enable_instrumentation:
        logger.info("Observability disabled. Set ENABLE_INSTRUMENTATION=true to enable telemetry.")
        _initialized = True
        return

    enable_sensitive = os.getenv("ENABLE_SENSITIVE_DATA", "false").lower() == "true"
    project_endpoint = os.getenv("PROJECT_ENDPOINT", "")

    # Try Foundry-native setup first
    if project_endpoint:
        try:
            success = await _setup_foundry_monitor(project_endpoint, enable_sensitive)
            if success:
                _initialized = True
                return
        except Exception as e:
            logger.warning(
                "Foundry-native observability setup failed, falling back to standard OTEL: %s", e
            )

    # Fallback: standard OpenTelemetry configuration
    _setup_otel_fallback(enable_sensitive)
    _initialized = True


async def _setup_foundry_monitor(project_endpoint: str, enable_sensitive: bool) -> bool:
    """Configure Azure Monitor using the Foundry project's linked App Insights.

    Returns True on success, False if the required packages are not available.
    """
    from agent_framework.azure import AzureAIClient
    from azure.ai.projects.aio import AIProjectClient
    from azure.identity.aio import DefaultAzureCredential

    async with (
        DefaultAzureCredential() as credential,
        AIProjectClient(endpoint=project_endpoint, credential=credential) as project_client,
        AzureAIClient(project_client=project_client) as client,
    ):
        await client.configure_azure_monitor(enable_live_metrics=True)

    # Activate MAF instrumentation code paths
    from agent_framework.observability import enable_instrumentation
    enable_instrumentation(enable_sensitive_data=enable_sensitive)

    logger.info("✅ Observability configured via Azure AI Foundry (Application Insights)")
    logger.info("   Traces, metrics, and logs will be sent to the project's linked App Insights")
    if enable_sensitive:
        logger.info("   ⚠️  Sensitive data logging is ENABLED (prompts, responses, tool args)")
    return True


def _setup_otel_fallback(enable_sensitive: bool) -> None:
    """Fallback: configure via standard OTEL environment variables or console."""
    from agent_framework.observability import configure_otel_providers

    configure_otel_providers(enable_sensitive_data=enable_sensitive)

    otel_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    console_enabled = os.getenv("ENABLE_CONSOLE_EXPORTERS", "false").lower() == "true"

    if otel_endpoint:
        logger.info("✅ Observability configured via OTLP endpoint: %s", otel_endpoint)
    elif console_enabled:
        logger.info("✅ Observability configured with console exporters")
    else:
        logger.info("✅ Observability configured (standard OTEL env vars)")

    if enable_sensitive:
        logger.info("   ⚠️  Sensitive data logging is ENABLED")
