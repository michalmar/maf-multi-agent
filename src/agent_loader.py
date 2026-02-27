"""Dynamic agent loader from YAML definitions.

Scans a directory for *.yaml files, parses each into an AgentDefinition,
and creates MAF FunctionTool objects that delegate to Foundry Prompt Agents.
"""

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import yaml
from jinja2 import Environment, FileSystemLoader
from agent_framework import FunctionTool
from pydantic import BaseModel, Field

from src.config import load_config
from src.foundry_client import run_foundry_agent

logger = logging.getLogger(__name__)

DEFAULT_AGENTS_DIR = Path(__file__).resolve().parent.parent / "agents"


@dataclass(frozen=True)
class AgentDefinition:
    """Parsed agent definition from a YAML file."""

    name: str
    display_name: str
    description: str
    task_description: str
    foundry_agent_name: str
    avatar: str = "🤖"
    role: str = ""
    model: str = ""


def parse_agent_yaml(path: Path) -> AgentDefinition:
    """Parse a single YAML file into an AgentDefinition."""
    with open(path) as f:
        data = yaml.safe_load(f)

    required_keys = {"name", "display_name", "description", "task_description", "foundry_agent_name"}
    missing = required_keys - set(data.keys())
    if missing:
        raise ValueError(f"Agent YAML {path.name} missing required keys: {missing}")

    return AgentDefinition(
        name=data["name"],
        display_name=data["display_name"],
        description=data["description"].strip(),
        task_description=data["task_description"].strip(),
        foundry_agent_name=data["foundry_agent_name"],
        avatar=data.get("avatar", "🤖"),
        role=data.get("role", ""),
        model=data.get("model", ""),
    )


def _make_tool_func(agent_def: AgentDefinition):
    """Create a closure-based tool function for a given agent definition.

    Returns a function that accepts a `task` string and delegates to the
    Foundry agent via the Responses API.
    """

    def _tool_func(task: str, _agent_def: AgentDefinition = agent_def) -> str:
        display = _agent_def.display_name.upper().replace(" ", "-")

        logger.info("═" * 60)
        logger.info("🔧 TOOL INVOKED: %s", _agent_def.name)
        logger.info("📋 ORCHESTRATOR → %s", display)
        logger.info("📝 Task: %s", task)
        logger.info("═" * 60)

        config = load_config()
        t0 = time.perf_counter()
        result = run_foundry_agent(
            project_endpoint=config.project_endpoint,
            agent_name=_agent_def.foundry_agent_name,
            task=task,
        )
        elapsed = time.perf_counter() - t0

        logger.info("═" * 60)
        logger.info("📋 %s → ORCHESTRATOR  (%.1fs)", display, elapsed)
        logger.info("📄 Response length: %d chars", len(result))
        logger.info("═" * 60)
        return result

    return _tool_func


def create_tool_from_definition(agent_def: AgentDefinition) -> FunctionTool:
    """Create a MAF FunctionTool from an AgentDefinition."""

    # Build a Pydantic model for the task parameter with the YAML-defined description
    task_field_description = agent_def.task_description

    class TaskInput(BaseModel):
        task: str = Field(description=task_field_description)

    # Give the model a unique name to avoid Pydantic conflicts
    TaskInput.__name__ = f"{agent_def.name}_input"
    TaskInput.__qualname__ = f"{agent_def.name}_input"
    TaskInput.model_rebuild()

    tool_func = _make_tool_func(agent_def)

    return FunctionTool(
        name=agent_def.name,
        description=agent_def.description,
        func=tool_func,
        input_model=TaskInput,
    )


def load_agents(agents_dir: Path | str | None = None) -> list[FunctionTool]:
    """Load all agent definitions from YAML files and return FunctionTool objects.

    Args:
        agents_dir: Directory containing *.yaml agent definition files.
                    Defaults to the `agents/` directory at the project root.

    Returns:
        List of FunctionTool objects ready to register on the orchestrator.
    """
    agents_path = Path(agents_dir) if agents_dir else DEFAULT_AGENTS_DIR

    if not agents_path.is_dir():
        logger.warning("Agents directory not found: %s", agents_path)
        return []

    yaml_files = sorted(agents_path.glob("*.yaml"))
    if not yaml_files:
        logger.warning("No *.yaml agent definitions found in %s", agents_path)
        return []

    tools: list[FunctionTool] = []
    definitions: list[AgentDefinition] = []

    for yaml_file in yaml_files:
        try:
            agent_def = parse_agent_yaml(yaml_file)
            definitions.append(agent_def)
            tool = create_tool_from_definition(agent_def)
            tools.append(tool)
            logger.info(
                "📂 Loaded agent: %s → %s (Foundry: %s)",
                yaml_file.name,
                agent_def.name,
                agent_def.foundry_agent_name,
            )
        except Exception as e:
            logger.error("❌ Failed to load agent from %s: %s", yaml_file.name, e)

    return tools


def list_agent_definitions(agents_dir: Path | str | None = None) -> list[AgentDefinition]:
    """Load and return all AgentDefinition objects from YAML files."""
    agents_path = Path(agents_dir) if agents_dir else DEFAULT_AGENTS_DIR

    if not agents_path.is_dir():
        return []

    definitions = []
    for yaml_file in sorted(agents_path.glob("*.yaml")):
        try:
            definitions.append(parse_agent_yaml(yaml_file))
        except Exception:
            pass
    return definitions


TEMPLATES_DIR = Path(__file__).parent / "templates"

def generate_orchestrator_instructions(tools: Sequence[FunctionTool]) -> str:
    """Generate orchestrator system instructions from loaded tools.

    Builds the instructions dynamically from a Jinja2 template so adding
    a new YAML agent automatically updates the orchestrator's knowledge
    of available tools.
    """
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        keep_trailing_newline=True,
    )
    template = env.get_template("orchestrator_instructions.jinja2")
    return template.render(tools=tools)
