# AGENTS.md — MAF Multi-Agent Architecture

> Auto-generated from the current implementation. Last updated: 2026-03-30.

---

## Architecture Overview

This project implements a **multi-agent orchestration system** using the [Microsoft Agent Framework (MAF)](https://github.com/microsoft/agent-framework) with Azure AI Foundry.

```
┌──────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                  │
│  └── SSE stream → activity feed, documents, results  │
├──────────────────────────────────────────────────────┤
│  Backend API (FastAPI + Uvicorn)                     │
│  └── POST /api/run → scratchpad workflow             │
├──────────────────────────────────────────────────────┤
│  Orchestrator (Facilitator)                          │
│  ├── MAF ChatAgent (Azure OpenAI Responses API)      │
│  ├── FacilitatorTools: TaskBoard + SharedDocument     │
│  └── Dispatch tools: one per specialist agent        │
├──────────────────────────────────────────────────────┤
│  Specialist Agents                                   │
│  ├── Foundry Prompt Agents (via Responses API)       │
│  └── Fabric MCP Agents (via JSON-RPC over HTTP)      │
└──────────────────────────────────────────────────────┘
```

### Key Patterns

- **Scratchpad Pattern**: Agents communicate via a shared `TaskBoard` (task tracking) and `SharedDocument` (collaborative writing) rather than direct message passing.
- **Facilitator Orchestration**: A central facilitator agent plans, dispatches tasks to specialists, reviews their contributions, consolidates the shared document, and synthesizes a final answer.
- **Event Streaming**: All agent activity is emitted as `AgentEvent` objects via SSE for real-time frontend display.

---

## Orchestrator (Facilitator)

| Property | Value |
|----------|-------|
| **Type** | MAF `ChatAgent` via `AzureOpenAIResponsesClient` |
| **Model** | Configurable via `AZURE_OPENAI_CHAT_DEPLOYMENT_NAME` env var |
| **Reasoning** | Configurable effort: `high`, `medium`, `low`, or `none` (UI-selectable) |
| **Prompt template** | `src/templates/facilitator_prompt.jinja2` |

### Facilitator Tools

| Tool | Description |
|------|-------------|
| `create_tasks` | Decompose a request into tasks assigned to specialists |
| `get_plan_status` | Check completion status of all tasks |
| `read_document` | Read the shared document (with agent attribution tags) |
| `consolidate_section` | Merge specialist contributions in a document slot |
| `read_document_clean` | Read the final document without agent tags |
| `call_<agent>` | Dispatch tools — one auto-generated per specialist agent |

### Workflow Steps

1. **PLAN** — Analyze request, create tasks via `create_tasks`
2. **DISPATCH** — Call specialist agents with assigned task IDs
3. **CHECK** — Verify all tasks completed via `get_plan_status`
4. **REVIEW & CONSOLIDATE** — Merge contributions, preserve inline images/charts
5. **FINAL ANSWER** — Present consolidated result to the user

---

## Specialist Agents

Specialist agents are defined in YAML files in the `agents/` directory and auto-discovered by `src/agent_loader.py`.

| Agent | Display Name | Type | Model | Role | Backend Name |
|-------|-------------|------|-------|------|-------------|
| `coderdata_tool` | Coder Data Agent | Foundry | gpt-5.2 | Software Engineer | `CoderData` |
| `data_analyst_tool` | Data Analyst | MCP | Fabric Data Agent | Data Analyst | `fabric-data-agent` |
| `kb_tool` | KB Agent | Foundry | gpt-4.1-mini | Operations Engineering | `OperationsEngineering` |
| `websearch_tool` | WebSearch Agent | Foundry | gpt-4o | Research Specialist | `WebSearch` |

### Agent Types

#### Foundry Prompt Agents
Invoked via the Azure AI Foundry Responses API (conversations). Each call:
1. Creates a `DefaultAzureCredential` + `AIProjectClient`
2. Resolves the agent by name
3. Creates a conversation, adds the user message
4. Streams the response (with Code Interpreter file extraction)

**Client:** `src/foundry_client.py` → `run_foundry_agent()`

#### Fabric MCP Agents
Invoked via direct HTTP calls to the Fabric Data Agent MCP endpoint using JSON-RPC protocol. Fabric Data Agent **requires user identity tokens** — service principal and managed identity tokens are rejected at the data query layer.

**Authentication flow (ACA Easy Auth):**
1. User accesses the app — ACA Easy Auth redirects to Entra ID login
2. Easy Auth manages session via cookie and injects `X-MS-TOKEN-AAD-ACCESS-TOKEN` header
3. Next.js route handler forwards the header to the FastAPI backend
4. Backend reads the header (priority: Easy Auth header > POST body > None)
5. Token is threaded through: `api.py → workflow.py → dispatcher.py → fabric_mcp_client.py`
6. MCP client uses the user token as Bearer for all Fabric API calls
7. Falls back to `DefaultAzureCredential` when no user token is available (local dev via `az login`)

**Client:** `src/fabric_mcp_client.py` → `run_fabric_mcp()`

---

## Communication Flow

```
User Query (Easy Auth session)
    │
    ▼
Facilitator (orchestrator)
    │
    ├── create_tasks([{text: "...", assigned_to: "coderdata_tool"}, ...])
    │       │
    │       ▼
    │   TaskBoard (tracks task status)
    │
    ├── call_coderdata_tool(task_ids=[1,2], message="...")
    │       │
    │       ▼
    │   Foundry Agent "CoderData"
    │       │
    │       ▼
    │   Specialist writes to SharedDocument
    │
    ├── call_data_analyst_tool(task_ids=[3], message="...")
    │       │
    │       ▼
    │   Fabric MCP "fabric-data-agent"
    │   (uses Easy Auth user token as Bearer)
    │       │
    │       ▼
    │   Specialist writes to SharedDocument
    │
    ├── get_plan_status() → verify all tasks done
    │
    ├── read_document() → review contributions
    │
    ├── consolidate_section() → merge entries (preserving charts)
    │
    └── Final answer → User
```

---

## Event Types

All events are streamed via SSE to the frontend.

| Event | Source | Description |
|-------|--------|-------------|
| `workflow_started` | orchestrator | Run begins |
| `reasoning` | orchestrator | LLM reasoning trace |
| `tool_decision` | orchestrator | LLM decides to call a tool |
| `tasks_created` | orchestrator | TaskBoard tasks created |
| `task_completed` | orchestrator | A task marked done |
| `document_updated` | document | SharedDocument content changed |
| `agent_started` | specialist | Specialist agent invoked |
| `agent_streaming` | specialist | Real-time text delta |
| `agent_completed` | specialist | Specialist finished |
| `agent_error` | specialist | Specialist failed |
| `output` | orchestrator | Final result |
| `workflow_completed` | orchestrator | Run finished |

---

## Adding a New Agent

1. **Create a YAML file** in `agents/` (e.g., `agents/my_agent.yaml`):
   ```yaml
   name: my_agent_tool
   display_name: My Agent
   avatar: 🔧
   role: Specialist Role
   model: gpt-4o (Foundry)

   description: >
     What this agent does and when to use it.

   task_description: >
     What kind of task input this agent expects.

   # For Foundry agents:
   foundry_agent_name: MyAgentName

   # For MCP agents, add:
   # type: mcp
   # mcp_url_env: MY_AGENT_MCP_URL
   # mcp_tool_name: my-tool
   # mcp_auth:
   #   type: default_credential          # uses Azure CLI / Managed Identity
   #   scope: https://api.fabric.microsoft.com/.default
   ```

2. **For Foundry type:** Deploy the agent in Azure AI Foundry portal.
3. **For MCP type:** Set the MCP URL env var. Auth uses `DefaultAzureCredential` (Azure CLI locally, Managed Identity in ACA).
4. **Restart the app** — the agent is auto-discovered by `agent_loader.py` and a dispatch tool is generated for the facilitator.

---

## Configuration

| Env Var | Description | Default |
|---------|-------------|---------|
| `PROJECT_ENDPOINT` | Azure AI Foundry project endpoint | — |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint | — |
| `AZURE_OPENAI_CHAT_DEPLOYMENT_NAME` | Orchestrator model deployment | `gpt-4o` |
| `AZURE_OPENAI_SUMMARY_DEPLOYMENT_NAME` | Event summary model | `gpt-4.1-nano` |
| `AZURE_CLIENT_ID` | Managed identity client ID (for ACA) | — |
| `FABRIC_CAPACITY_RESOURCE_ID` | ARM resource ID for Fabric capacity status | — |
| `FABRIC_DATA_AGENT_MCP_URL` | Fabric Data Agent MCP endpoint | — |

---

## Project Structure

```
├── backend/
│   ├── src/                    # Python backend
│   │   ├── api.py              # FastAPI server + SSE streaming
│   │   ├── orchestrator.py     # MAF orchestrator + reasoning logger
│   │   ├── agent_loader.py     # YAML agent loader + tool factory
│   │   ├── foundry_client.py   # Foundry Prompt Agent client
│   │   ├── fabric_mcp_client.py # Fabric MCP client
│   │   ├── fabric_capacity.py  # Fabric capacity status (ARM API)
│   │   ├── config.py           # Environment config loader
│   │   ├── events.py           # AgentEvent model + EventType enum
│   │   ├── file_store.py       # In-memory file store for sandbox files
│   │   ├── summary.py          # LLM-powered event summarization
│   │   ├── observability.py    # Azure Monitor + OpenTelemetry setup
│   │   ├── templates/          # Jinja2 prompt templates
│   │   └── scratchpad/         # Scratchpad pattern implementation
│   │       ├── workflow.py     # Main workflow orchestration
│   │       ├── taskboard.py    # Thread-safe task tracking
│   │       ├── shared_document.py # Collaborative document
│   │       ├── facilitator_tools.py # Facilitator tool definitions
│   │       ├── dispatcher.py   # Agent dispatch logic
│   │       └── specialist_tools.py # Tools given to specialists
│   ├── agents/                 # YAML agent definitions
│   ├── tests/                  # pytest test suite
│   ├── pyproject.toml          # Python dependencies
│   └── uv.lock                 # Locked dependencies
├── frontend/                   # Next.js App Router frontend
│   ├── app/                    # Pages + API route handlers
│   ├── components/             # React components
│   ├── hooks/                  # React hooks (theme, pinned header)
│   └── lib/                    # Types, metadata, starter prompts
├── deploy/                     # Deployment infrastructure
│   ├── deploy.sh               # ACR build + ACA update script
│   └── terraform/              # IaC (ACR, ACA, managed identity)
├── .github/workflows/          # CI/CD
│   └── deploy.yml              # GitHub Actions → ACA deployment
├── Dockerfile                  # Multi-stage (Python + Node.js)
└── supervisord.conf            # Runs backend + frontend in one container
```
