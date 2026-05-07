"""Unit tests for specialist dispatch prompt assembly."""

import pytest

from src.agent_loader import AgentDefinition, McpAuthConfig
from src.scratchpad.dispatcher import create_dispatch_tools
from src.scratchpad.shared_document import SharedDocument
from src.scratchpad.taskboard import TaskBoard


@pytest.mark.asyncio
async def test_dispatch_appends_agent_specific_instructions(monkeypatch):
    """Dispatcher appends YAML-provided instructions to the MCP prompt."""
    board = TaskBoard()
    board.create_tasks([
        {
            "text": "Analyze Fabric operational data for COMP-001.",
            "assigned_to": "data_analyst_tool",
        }
    ])
    document = SharedDocument()
    captured: dict[str, str] = {}

    def fake_run_fabric_mcp(**kwargs):
        captured["task"] = kwargs["task"]
        return "analysis complete"

    monkeypatch.setattr("src.scratchpad.dispatcher.run_fabric_mcp", fake_run_fabric_mcp)
    monkeypatch.setattr(
        "src.scratchpad.dispatcher.list_agent_definitions",
        lambda _agents_dir=None: [
            AgentDefinition(
                name="data_analyst_tool",
                display_name="Data Analyst",
                description="Analyze data.",
                task_description="Data task.",
                agent_type="mcp",
                mcp_url_env="FABRIC_DATA_AGENT_MCP_URL",
                mcp_tool_name="fabric-data-agent",
                mcp_auth=McpAuthConfig(type="default_credential"),
                dispatch_instructions="Use mylake1.sensor and EquipmentID = 'COMP-001'.",
            )
        ],
    )

    tools = create_dispatch_tools(board, document, selected_agents=["data_analyst_tool"])
    result = await tools[0].func(task_ids="[1]", message="Pull COMP-001 timeseries.")

    assert "Data Analyst completed 1 tasks" in result
    assert "Pull COMP-001 timeseries." in captured["task"]
    assert "Analyze Fabric operational data for COMP-001." in captured["task"]
    assert "Specialist-specific instructions:" in captured["task"]
    assert "Use mylake1.sensor and EquipmentID = 'COMP-001'." in captured["task"]
    assert "names, prices, times" not in captured["task"]
