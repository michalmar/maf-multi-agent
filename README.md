# MAF & Foundry Agent Orchestration

A multi-agent system that combines **Microsoft Agent Framework (MAF)** as the orchestrator with **Azure AI Foundry** specialist agents and **Fabric Data Agent** via MCP. Features a real-time web UI with SSE event streaming.

![app](docs/app.png)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Web UI (React)                    │
│       Next.js · Tailwind CSS · SSE · MSAL auth      │
└──────────────────────┬──────────────────────────────┘
                       │ SSE / REST
┌──────────────────────▼──────────────────────────────┐
│               FastAPI Backend (api.py)              │
│         POST /api/run · GET /api/stream/:id         │
│         GET /api/result/:id · GET /api/agents       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│          MAF Orchestrator (Responses API)            │
│    Scratchpad: TaskBoard + SharedDocument            │
│    Delegates tasks via FunctionTool per agent        │
└──┬──────────┬──────────┬──────────┬─────────────────┘
   │          │          │          │
┌──▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼──────────────┐
│📊Data│ │📚 KB  │ │💻Code │ │🔍 Web            │
│Analyst│ │ Agent │ │  Agent│ │ Search           │
└──┬───┘ └───┬───┘ └───┬───┘ └───┬───────────────┘
   │         │         │         │
   │     Foundry Responses API   │
   │     (DefaultAzureCredential)│
   │                             │
   ▼                             │
Fabric Data Agent MCP            │
(MSAL user token passthrough)    │
User identity ──► Fabric API
```

**Two agent execution paths (YAML-driven):**
- **`type: foundry`** (default) — delegates to Azure AI Foundry Prompt Agents via Responses API using managed identity
- **`type: mcp`** — calls Fabric Data Agent MCP endpoint directly via HTTP JSON-RPC with MSAL user token authentication (Fabric requires user identity for data queries)

**Key patterns:**
- **Scratchpad Memory** — shared `TaskBoard` (progress tracking) and `SharedDocument` (collaborative output) accessible to all agents
- **YAML-driven agents** — sub-agents defined declaratively in `backend/agents/*.yaml`, auto-loaded as MAF `FunctionTool`s
- **Real-time streaming** — events from all agents propagated via SSE to the frontend (async dispatch with `asyncio.to_thread`)

## Prerequisites

- Python 3.11+
- Node.js 18+
- Azure AI Foundry project with deployed Prompt Agents (`OperationsEngineering`, `Coder`, `WebSearch`)
- Azure OpenAI deployment (e.g. `gpt-5.2`) for the orchestrator
- *(Optional)* Fabric Data Agent with MCP endpoint + Entra ID SPA app registration for MSAL user auth

## Setup

### 1. Environment variables

Create a `.env` file:

```env
PROJECT_ENDPOINT=https://<your-foundry-endpoint>/api/projects/<project>
AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-5.2
AZURE_OPENAI_SUMMARY_DEPLOYMENT_NAME=gpt-4.1-nano
```

Authentication uses `DefaultAzureCredential` — ensure you are logged in via `az login`.

#### Fabric Data Agent (optional)

To enable the data analyst agent with Fabric MCP, add:

```env
FABRIC_DATA_AGENT_MCP_URL=https://api.fabric.microsoft.com/v1/mcp/workspaces/<id>/dataagents/<id>/agent
```

Authentication uses **MSAL user tokens** — Fabric Data Agent requires user identity for data queries (service principals and managed identities are rejected at the data layer).

**Setup steps:**
1. Create an Entra ID SPA app registration (`az ad app create`)
2. Add SPA redirect URIs: `http://localhost:3000` and your ACA FQDN
3. Add delegated permission: `Fabric DataAgent.Execute.All` + grant admin consent
4. Update `frontend/lib/msal-config.ts` with your app's client ID and tenant ID
5. Add the Container App's Managed Identity to your Fabric workspace as **Admin** (needed for MCP handshake)

Users sign in via MSAL in the browser. The token flows through the backend to the Fabric MCP client. See `deploy/terraform/` for infrastructure setup.

### 2. Backend

```bash
cd backend

# Install dependencies (using uv)
uv sync

# Run tests
uv run pytest

# Start API server
uv run uvicorn src.api:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # Next.js dev server at http://localhost:3000
npm run build        # Production build
npm run start        # Run the production build
```

The Next.js frontend rewrites `/api/*` requests to the backend at `http://localhost:8000` by default. Override the backend origin with `BACKEND_API_URL` if needed.

## Project Structure

```
backend/
  agents/              # YAML agent definitions
  src/
    api.py             # FastAPI server + SSE streaming
    orchestrator.py    # MAF orchestrator setup
    agent_loader.py    # YAML agent parser + loader
    events.py          # Event types and callback definitions
    config.py          # Environment configuration
    scratchpad/
      workflow.py      # Main workflow entry point
      dispatcher.py    # Async dispatch to Foundry agents
      taskboard.py     # Task tracking scratchpad
      shared_document.py  # Collaborative document scratchpad
  tests/               # Backend test suite
  pyproject.toml       # Python dependencies
  uv.lock
frontend/
  app/
    page.tsx           # Next.js App Router entry point
    globals.css        # Global theme and layout styles
  components/
    auth-provider.tsx  # MSAL authentication provider
  hooks/
    use-fabric-token.ts # Fabric token acquisition hook
  lib/
    msal-config.ts     # MSAL client + scope configuration
    types.ts           # Typed models and UI metadata helpers
deploy/                # Terraform IaC + deploy script
docs/                  # PRD and design documents
```

## Usage

1. Start both backend and frontend
2. Open `http://localhost:3000`
3. Enter a travel planning request (e.g. *"Plan a 5-day trip to Tokyo from NYC, budget $3000"*)
4. Watch agents collaborate in real-time — tasks appear, agents activate, and a travel document is built incrementally

For UI tuning without running the full backend flow, use the **Load mock replay** control in the query composer. It loads a completed maintenance-style run fixture directly in the browser so you can refine the layout, telemetry cards, long activity feed, task board, and document/result panes offline.

## License

MIT
