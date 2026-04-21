# MAF & Foundry Agent Orchestration

A multi-agent system that combines **Microsoft Agent Framework (MAF)** as the orchestrator with **Azure AI Foundry** specialist agents and **Fabric Data Agent** via MCP. Features a real-time web UI with SSE event streaming plus resumable background runs.

![app](docs/app.png)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Web UI (React)                    │
│   Next.js · Tailwind CSS · SSE / polling · Easy Auth │
└──────────────────────┬──────────────────────────────┘
                       │ SSE / REST
┌──────────────────────▼──────────────────────────────┐
│               FastAPI Backend (api.py)              │
│   POST /api/run · GET /api/stream/:id · /history    │
│        GET /api/result/:id · GET /api/agents        │
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
(Easy Auth token passthrough)    │
User identity ──► Fabric API
```

**Two agent execution paths (YAML-driven):**
- **`type: foundry`** (default) — delegates to Azure AI Foundry Prompt Agents via Responses API using managed identity
- **`type: mcp`** — calls Fabric Data Agent MCP endpoint directly via HTTP JSON-RPC with ACA Easy Auth user token authentication (Fabric requires user identity for data queries)

**Key patterns:**
- **Scratchpad Memory** — shared `TaskBoard` (progress tracking) and `SharedDocument` (collaborative output) accessible to all agents
- **YAML-driven agents** — sub-agents defined declaratively in `backend/agents/*.yaml`, auto-loaded as MAF `FunctionTool`s
- **Real-time streaming** — events from all agents propagated via SSE to the frontend (async dispatch with `asyncio.to_thread`)
- **Background resumability** — active runs checkpoint their latest status, events, tasks, and documents so users can reload, navigate away, and later resume a still-running session from history
- **Email notifications** — facilitator can email results to the logged-in user via Microsoft Graph when explicitly requested

## Prerequisites

- Python 3.11+
- Node.js 18+
- Azure AI Foundry project with deployed Prompt Agents (`OperationsEngineering`, `Coder`, `WebSearch`)
- Azure OpenAI deployment (e.g. `gpt-5.2`) for the orchestrator
- *(Optional)* Fabric Data Agent with MCP endpoint + ACA Easy Auth (Entra ID) for user authentication
- *(Optional)* Shared/admin mailbox + Managed Identity with `Mail.Send` application permission for email notifications

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

Authentication uses **ACA Easy Auth** — the entire app is gated behind Entra ID login. Easy Auth injects user tokens into request headers, which the backend uses for Fabric API calls. Service principals and managed identities are rejected by Fabric at the data layer.

**Setup (automated via Terraform):**
Set `enable_easy_auth = true` and `enable_fabric_data_agent = true` in `terraform.tfvars`, then run `terraform apply`. This creates the Entra app registration, client secret, admin consent grants, token store, and ACA auth config automatically.

After apply, run `./deploy/post_infra_deploy.sh` — the only manual step is adding the MI to your Fabric workspace as Admin.

**Local development:** Easy Auth is not available locally. `DefaultAzureCredential` (via `az login`) is used as fallback — ensure your Azure CLI user has Fabric workspace access.

#### Email Notifications (optional)

The facilitator can email results to the logged-in user when explicitly asked (e.g. *"email me the results"*). To enable:

```env
MAIL_SENDER_ADDRESS=admin-mailbox@yourdomain.com
```

**Requirements:**
- A shared or admin mailbox to send from (`MAIL_SENDER_ADDRESS`)
- The Managed Identity (or `az login` user locally) must have **`Mail.Send`** application permission on Microsoft Graph
- User email is resolved automatically from Easy Auth headers (`X-MS-CLIENT-PRINCIPAL-NAME`) or the access token

The feature is disabled when `MAIL_SENDER_ADDRESS` is not set — no code changes needed to opt out.

#### Persistent History Storage (optional)

By default, run history is stored on the container's ephemeral filesystem and is lost on ACA redeploy/restart. Active runs are checkpointed there while they execute, which is enough to resume them after page reload/navigation as long as the app process stays alive. To persist history durably in Azure Blob Storage:

```env
HISTORY_STORAGE_ACCOUNT_URL=https://<storage-account>.blob.core.windows.net
```

**Requirements:**
- An Azure Storage Account with a blob container named `history`
- The Managed Identity must have **`Storage Blob Data Contributor`** role on the storage account
- No shared key access required — auth via `DefaultAzureCredential`

**Setup via Terraform:** Set `enable_history_storage = true` in `terraform.tfvars` and run `terraform apply`. This creates the storage account, blob container, RBAC role assignment, lifecycle management policy, and injects the env var into the Container App automatically.

When `HISTORY_STORAGE_ACCOUNT_URL` is not set, the app falls back to local filesystem storage (suitable for development). In that mode, completed and in-progress runs survive browser reloads and route changes, but not container restarts or redeploys.

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
    graph_mail_client.py  # Microsoft Graph email sender
    history_store.py   # Persistent history (Blob Storage / local filesystem)
    scratchpad/
      workflow.py      # Main workflow entry point
      dispatcher.py    # Async dispatch to Foundry agents
      taskboard.py     # Task tracking scratchpad
      shared_document.py  # Collaborative document scratchpad
      mail_tools.py    # Email notification tools
  tests/               # Backend test suite
  pyproject.toml       # Python dependencies
  uv.lock
frontend/
  app/
    page.tsx           # Next.js App Router entry point
    globals.css        # Global theme and layout styles
  components/
    planner-shell.tsx  # Main UI shell (Easy Auth user profile)
  hooks/
    use-theme.ts       # Theme toggle hook
  lib/
    types.ts           # Typed models and UI metadata helpers
deploy/                # Terraform IaC + deploy script
docs/                  # PRD and design documents
```

## Usage

1. Start both backend and frontend
2. Open `http://localhost:3000`
3. Enter a travel planning request (e.g. *"Plan a 5-day trip to Tokyo from NYC, budget $3000"*)
4. Watch agents collaborate in real-time — tasks appear, agents activate, and a travel document is built incrementally
5. You can reload the page, switch views, or return later and reopen the run from **History** while it is still running or after it finishes

For UI tuning without running the full backend flow, use the **Load mock replay** control in the query composer. It loads a completed maintenance-style run fixture directly in the browser so you can refine the layout, telemetry cards, long activity feed, task board, and document/result panes offline.

## License

MIT
