# PRD: MAF & Foundry Agent Orchestration — MAF Orchestrator + Azure AI Foundry Sub-Agents

> **Status**: Implemented  
> **Last Updated**: 2026-02-26  
> **Repository**: `maf-multi-agent`

---

## 1. Problem Statement

Building multi-agent AI systems today requires choosing between two paradigms:

- **Azure AI Foundry Agent Service** — managed, server-side agents with built-in conversations, persistence, tool execution, and observability. Great for individual domain agents, but the native multi-agent orchestration (ConnectedAgentTool) locks you into Foundry-only composition.
- **Microsoft Agent Framework (MAF)** — open-source, provider-agnostic SDK for local agent creation and multi-agent workflows. Powerful orchestration primitives, but agents are ephemeral and locally managed.

**The opportunity**: combine both — use MAF as a lightweight, code-first orchestration layer that delegates domain work to managed Foundry agents. This gives you Foundry's managed execution, persistence, and observability for each specialist agent, while MAF provides flexible, testable, provider-agnostic orchestration in your own compute.

---

## 2. Proposed Solution

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       User / Client                              │
│                  (CLI, FastAPI — future)                          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ user message
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│     MAF Facilitator Agent (AzureOpenAIResponsesClient)           │
│     Model: gpt-5.1 (reasoning: effort=low, summary=auto)        │
│                                                                  │
│     ┌─────────────────────────────────────────────────┐          │
│     │           Scratchpad Pattern                     │          │
│     │  ┌──────────┐  ┌───────────────┐                │          │
│     │  │ TaskBoard │  │SharedDocument │                │          │
│     │  └──────────┘  └───────────────┘                │          │
│     └─────────────────────────────────────────────────┘          │
│                                                                  │
│  Tools:                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────────────────────┐ │
│  │ create_tasks │ │ get_status   │ │ consolidate / read_doc    │ │
│  └──────────────┘ └──────────────┘ └───────────────────────────┘ │
│  ┌──────────────────┐ ┌──────────────────┐                       │
│  │ call_flights_tool │ │ call_hotels_tool │  ← YAML-defined      │
│  └────────┬─────────┘ └────────┬─────────┘                       │
│           │ streaming events    │ streaming events                │
└───────────┼─────────────────────┼────────────────────────────────┘
            │                     │
            ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│              Azure AI Foundry Project (Responses API)            │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                      │
│  │ flight-agent-v2  │  │ hotel-agent-v2   │                      │
│  │  (managed)       │  │  (managed)       │                      │
│  └──────────────────┘  └──────────────────┘                      │
│                                                                  │
│  Conversations / Responses API (server-side state)               │
│  Streaming: ResponseTextDeltaEvent → real-time tokens            │
└──────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Orchestration layer | MAF Facilitator agent with function tools | Provider-agnostic, testable, full Python control over routing logic |
| Orchestrator LLM client | `AzureOpenAIResponsesClient` (Responses API) | Server-side conversation state, native reasoning content, `project_endpoint` routing |
| Orchestrator model | `gpt-5.1` with `reasoning: {effort: "low", summary: "auto"}` | Strong reasoning for task decomposition; reasoning summaries logged for observability |
| Sub-agent runtime | Azure AI Foundry Agent Service (Responses API) | Managed execution, server-side conversations, enterprise observability |
| Sub-agent invocation | `openai.responses.create()` with `agent_reference` + `stream=True` | Real-time token streaming from sub-agents; conversations API for state management |
| Agent definitions | YAML files in `agents/` directory | Declarative, no code changes to add new agents |
| Orchestration pattern | Scratchpad (TaskBoard + SharedDocument) | Structured task decomposition, parallel agent contributions, facilitator consolidation |
| Inter-agent communication | Dispatch tools (sync Python) wrapping async Foundry calls | Thread-safe queue bridges streaming events from worker threads to main loop |
| Event streaming | Callback-based `AgentEvent` model | Unified event stream from orchestrator reasoning, tool decisions, and sub-agent token deltas |
| Output persistence | Markdown files per run in `output/` | Run ID + timestamp header, both final result and raw agent contributions saved |

---

## 3. Use Case: Travel Planner

A user asks for a complete 3-day trip plan. The facilitator decomposes the request into tasks, dispatches specialist agents, consolidates their contributions, and synthesizes a final plan.

### User Story

> *"I'm in Prague and want a 3-day trip to London next month. Find reasonable flights and a mid-range hotel near good public transport."*

### Agent Roles

| Agent | Runtime | Responsibility |
|-------|---------|---------------|
| `travel-facilitator` | MAF (local, gpt-5.1) | Decompose request into tasks, dispatch specialists, consolidate, synthesize final plan |
| `flight-agent-v2` | Foundry (managed) | Given origin, destination, dates, budget → propose flight options with tradeoffs |
| `hotel-agent-v2` | Foundry (managed) | Given city, dates, budget → suggest neighborhoods and hotel options with pros/cons |

### Interaction Flow (Scratchpad Pattern)

```
User → "Plan me a 3-day London trip from Prague next month, mid-range budget"
  │
  ▼
Facilitator (MAF):
  1. 🧠 REASONING: Analyzes request, plans task decomposition
  2. 🔧 TOOL: create_tasks() — creates 4-6 tasks assigned to specialists
     ┌─── TaskBoard Status (0/5 done) ───
     │ ⏳ [1] (flights_tool): Find round-trip flights...
     │ ⏳ [2] (flights_tool): Compare London airports...
     │ ⏳ [3] (hotels_tool): Recommend mid-range hotels...
     │ ⏳ [4] (hotels_tool): Check transport access...
     └────────────────────────────────────
  3. 🔧 TOOL: call_flights_tool(tasks=[1,2]) — dispatches to Foundry
     ✈️  [flights_tool] Agent started: flight-agent-v2
     ✈️  [flights_tool] ▸ streaming tokens in real-time...
     ✈️  [flights_tool] ✅ Completed (4367 chars, 9.7s)
  4. 🔧 TOOL: call_hotels_tool(tasks=[3,4]) — dispatches to Foundry
     🏨 [hotels_tool] Agent started: hotel-agent-v2
     🏨 [hotels_tool] ▸ streaming tokens in real-time...
     🏨 [hotels_tool] ✅ Completed (3161 chars, 7.8s)
  5. 🔧 TOOL: get_plan_status() — verify all tasks done
  6. 🔧 TOOL: read_document() → consolidate_section() → read_document_clean()
  7. 📝 OUTPUT: Synthesized travel plan
  │
  ▼
User ← Complete travel plan with flights, hotels, and practical tips
       📄 Result saved to: output/{run_id}-result.md
       📋 Document saved to: output/{run_id}-document.md
```

---

## 4. Technical Specification

### 4.1 SDK Dependencies

```toml
# pyproject.toml
[project]
dependencies = [
    "agent-framework-core @ git+https://github.com/microsoft/agent-framework.git@main#subdirectory=python/packages/core",
    "agent-framework-azure-ai @ git+https://github.com/microsoft/agent-framework.git@main#subdirectory=python/packages/azure-ai",
    "azure-ai-projects>=1.0.0",
    "azure-ai-agents>=1.0.0",
    "azure-identity>=1.19.0",
    "openai>=1.58.0",
    "pyyaml>=6.0",
    "python-dotenv>=1.0.0",
]
```

### 4.2 Configuration

```env
# .env
PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
AZURE_OPENAI_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_OPENAI_CHAT_DEPLOYMENT_NAME=gpt-5.1
```

- `PROJECT_ENDPOINT` — used by both the orchestrator (`AzureOpenAIResponsesClient`) and Foundry sub-agent calls (`AIProjectClient`)
- `AZURE_OPENAI_ENDPOINT` — cognitiveservices endpoint (fallback, not used by Responses API)
- Sub-agent names are defined in YAML files, not in `.env`

### 4.3 Module Structure

```
maf-multi-agent/
├── agents/                         # YAML agent definitions (one per specialist)
│   ├── flights.yaml
│   └── hotels.yaml
├── docs/
│   ├── PRD-maf-foundry-multi-agent.md   # This PRD
│   ├── PRD-agents-scratchpad-pattern.md  # Scratchpad pattern design
│   ├── event-streaming-analysis.md      # Event streaming research
│   └── maf-orch-idea.md                 # Original idea document
├── output/                         # Run outputs (gitignored)
│   ├── {run_id}-result.md          # Final synthesized plan
│   └── {run_id}-document.md        # Raw agent contributions
├── src/
│   ├── __init__.py
│   ├── config.py                   # Environment config loader
│   ├── events.py                   # AgentEvent model + EventType enum
│   ├── foundry_client.py           # Foundry Responses API client (streaming)
│   ├── agent_loader.py             # YAML → FunctionTool dynamic loader
│   ├── orchestrator.py             # MAF orchestrator + reasoning logger
│   ├── main.py                     # CLI entry point + event renderer
│   └── scratchpad/
│       ├── __init__.py
│       ├── taskboard.py            # Task lifecycle (create/read/complete)
│       ├── shared_document.py      # Slot-based collaborative workspace
│       ├── facilitator_tools.py    # Tools for the facilitator agent
│       ├── specialist_tools.py     # Tools for specialist agents
│       ├── dispatcher.py           # Creates dispatch tools from YAML
│       └── workflow.py             # Scratchpad workflow orchestration
├── tests/
│   ├── test_taskboard.py
│   ├── test_shared_document.py
│   ├── test_facilitator_tools.py
│   ├── test_specialist_tools.py
│   ├── test_agent_loader.py
│   ├── test_orchestrator.py
│   └── test_foundry_client.py
├── pyproject.toml
└── .env
```

### 4.4 Implementation Details

#### 4.4.1 YAML Agent Definitions (`agents/*.yaml`)

Each sub-agent is defined declaratively. Adding a new agent requires only a new YAML file:

```yaml
# agents/flights.yaml
name: flights_tool
display_name: Flights Agent
description: Finds and compares flight options between cities.
task_description: Search for flights matching the given criteria.
foundry_agent_name: flight-agent-v2
```

The `agent_loader.py` scans `agents/` at startup, creates `FunctionTool` objects with Pydantic input models, and generates orchestrator instructions dynamically.

#### 4.4.2 Foundry Client (`foundry_client.py`)

Invokes Foundry agents using the Responses API with server-side conversations:

```python
# Flow: resolve agent → create conversation → add message → invoke via responses.create
agent = await project_client.agents.get(agent_name=name)
conversation = await openai_client.conversations.create()
await openai_client.conversations.items.create(conversation_id=conv.id, items=[...])

# Streaming mode — real-time token deltas
stream = await openai_client.responses.create(
    conversation=conv.id,
    stream=True,
    extra_body={"agent_reference": {"name": agent.name, "type": "agent_reference"}},
)
async for event in stream:
    if type(event).__name__ == "ResponseTextDeltaEvent":
        event_queue.put(AgentEvent(event_type=EventType.AGENT_STREAMING, ...))
```

Key implementation details:
- Runs in a separate thread (`ThreadPoolExecutor`) with its own `asyncio` event loop
- Events bridge from worker thread to main loop via `queue.Queue` (thread-safe stdlib)
- Supports both streaming (with `event_callback`) and non-streaming modes

#### 4.4.3 Orchestrator + Reasoning Logger (`orchestrator.py`)

The orchestrator uses `AzureOpenAIResponsesClient` with a client-level intercept that logs reasoning phases BEFORE tools execute:

```python
client = AzureOpenAIResponsesClient(
    credential=AzureCliCredential(),
    project_endpoint=config.project_endpoint,
    deployment_name="gpt-5.1",
)

# Wraps _inner_get_response to intercept each raw API call
attach_reasoning_logger(client, event_callback=callback)

agent = client.as_agent(
    name="travel-facilitator",
    instructions=FACILITATOR_SYSTEM_PROMPT,
    tools=all_tools,
    default_options={"reasoning": {"effort": "low", "summary": "auto"}},
)
```

The reasoning logger:
- Intercepts at the raw API level (below `FunctionInvocationLayer`)
- Logs `text_reasoning` → 🧠 REASONING, `function_call` → 🔧 TOOL DECISIONS, `text` → 📝 OUTPUT
- Emits corresponding `AgentEvent` objects for the unified event stream

#### 4.4.4 Scratchpad Pattern (`src/scratchpad/`)

The scratchpad pattern provides structured collaboration between the facilitator and specialists:

- **TaskBoard**: In-memory task list with `create_tasks()`, `read_tasks()`, `complete_task()`. Logs status tables with ✅/⏳ icons.
- **SharedDocument**: Slot-based workspace (day → time_slot → entries). Specialists `write_section()`, facilitator `consolidate_section()`. Snapshots raw contributions before consolidation for output files.
- **Dispatcher**: Creates `call_<agent>` `FunctionTool` per YAML agent. Each dispatch: reads tasks → calls Foundry agent (streaming) → writes to SharedDocument → auto-completes tasks.
- **Workflow**: Entry point that wires everything together — creates TaskBoard + SharedDocument, builds facilitator with all tools, runs the agent.

#### 4.4.5 Event Streaming (`src/events.py`)

Unified event model for real-time visibility into the entire orchestration:

```python
class EventType(str, Enum):
    WORKFLOW_STARTED = "workflow_started"
    WORKFLOW_COMPLETED = "workflow_completed"
    REASONING = "reasoning"          # Orchestrator reasoning phase
    TOOL_DECISION = "tool_decision"  # Orchestrator tool call decision
    OUTPUT = "output"                # Orchestrator final text output
    AGENT_STARTED = "agent_started"  # Sub-agent invocation begins
    AGENT_STREAMING = "agent_streaming"  # Sub-agent token delta
    AGENT_COMPLETED = "agent_completed"  # Sub-agent finished
    AGENT_ERROR = "agent_error"      # Sub-agent error

@dataclass
class AgentEvent:
    event_type: EventType
    source: str          # "orchestrator", "flights_tool", "hotels_tool"
    data: dict[str, Any]
    timestamp: float
```

Events flow through a callback (`EventCallback = Callable[[AgentEvent], None]`) wired from `main.py` → `workflow.py` → `dispatcher.py` / `orchestrator.py` → `foundry_client.py`.

#### 4.4.6 CLI Entry Point (`src/main.py`)

```
python -m src.main                     # Default query, scratchpad mode
python -m src.main --mode simple ...   # Simple orchestrator (no scratchpad)
python -m src.main --mode scratchpad   # Scratchpad workflow (default)
python -m src.main "custom query"      # Custom query
```

Renders events with agent-specific icons (✈️ flights, 🏨 hotels, 🤖 orchestrator). Saves output as markdown with run ID.

---

## 5. Design Considerations

### 5.1 Why MAF as Orchestrator (Not Foundry's ConnectedAgentTool)

| Aspect | MAF Orchestrator | Foundry ConnectedAgentTool |
|--------|-----------------|---------------------------|
| **Flexibility** | Any Python logic, custom routing, conditionals, scratchpad patterns | Declarative tool wiring, limited control flow |
| **Provider lock-in** | Can swap orchestrator model (OpenAI, Anthropic, Ollama) | Locked to Foundry-hosted models |
| **Testability** | Mock tools in unit tests, run locally (49 tests) | Requires live Foundry project |
| **Observability** | Custom reasoning logger, unified event stream, markdown output | Foundry's built-in monitoring |
| **Streaming** | Real-time events from both orchestrator and sub-agents | Limited to single-agent streaming |
| **Agent definitions** | YAML-driven, add agents without code changes | Requires code changes for new tools |

### 5.2 Why Responses API (Not Chat Completions or Assistants API)

| Aspect | Responses API (current) | Chat Completions (previous) | Assistants API (deprecated) |
|--------|------------------------|-----------------------------|-----------------------------|
| **Conversation state** | Server-side (`conversation_id`) | Client-side (message list) | Server-side (threads) |
| **Reasoning content** | Native `text_reasoning` content type | Not available | Not available |
| **Agent references** | Native `agent_reference` for Foundry agents | Not supported | `asst_*` IDs |
| **Streaming** | `ResponseTextDeltaEvent` etc. | `ChatResponseUpdate` | Event handlers |
| **MAF integration** | `AzureOpenAIResponsesClient` | `AzureOpenAIChatClient` | N/A |

### 5.3 Thread Strategy: Conversation-per-Invocation

Each sub-agent call creates a fresh conversation via `openai.conversations.create()`. This is stateless and simple — no context leaks between calls. The server manages conversation state.

### 5.4 Testing Strategy

| Level | Count | What | How |
|-------|-------|------|-----|
| **Unit** | 49 tests | TaskBoard, SharedDocument, FacilitatorTools, SpecialistTools, AgentLoader, Orchestrator, FoundryClient | Mocked dependencies, pytest |
| **Smoke** | Manual | Full end-to-end with live Foundry | `python -m src.main` with Azure credentials |

---

## 6. Future Extensions

### 6.1 Additional Sub-Agents

Add new agents by creating YAML files in `agents/`:

| Agent | YAML file | Purpose |
|-------|-----------|---------|
| `activities-agent` | `agents/activities.yaml` | Day trip ideas, museum recommendations |
| `budget-agent` | `agents/budget.yaml` | Cost estimation and optimization |
| `weather-agent` | `agents/weather.yaml` | Weather forecast integration |

### 6.2 Web UI (SSE/WebSocket)

The event streaming infrastructure (`AgentEvent` + `EventCallback`) is designed to support web clients:

```python
# Future: FastAPI SSE endpoint
@app.get("/plan")
async def plan(query: str):
    async def event_generator():
        async for event in run_workflow_with_events(query):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

### 6.3 Parallel Sub-Agent Dispatch

Currently sub-agents run sequentially (one after another). Future: dispatch multiple agents in parallel using `asyncio.gather()` with separate threads per agent.

### 6.4 Conversational Memory

- Add session management for multi-turn conversations
- Reuse Foundry conversations for stateful sub-agent interactions
- Integrate MAF's session/context providers

---

## 7. Implementation Status

### ✅ Phase 1: Foundation (Complete)
- Project structure with `src/` package, config, `.env`
- `foundry_client.py` with Responses API + streaming support
- `agent_loader.py` for YAML → FunctionTool dynamic loading
- 49 unit tests

### ✅ Phase 2: Scratchpad Orchestration (Complete)
- TaskBoard + SharedDocument collaborative workspace
- FacilitatorTools + SpecialistTools
- Dispatcher creates `call_<agent>` tools from YAML definitions
- Full scratchpad workflow with task decomposition → dispatch → consolidate → synthesize

### ✅ Phase 3: Responses API Migration (Complete)
- Migrated from `AzureOpenAIChatClient` to `AzureOpenAIResponsesClient`
- `project_endpoint` routing (not `endpoint`)
- Reasoning options: `{"reasoning": {"effort": "low", "summary": "auto"}}`
- Native `text_reasoning` content type for observability

### ✅ Phase 4: Reasoning Observability (Complete)
- Client-level reasoning logger (`attach_reasoning_logger`) intercepts each raw API call
- Logs 🧠 REASONING → 🔧 TOOL DECISIONS → 📝 OUTPUT inline, before tool execution
- Emits `AgentEvent` objects for unified event stream

### ✅ Phase 5: Event Streaming (Complete)
- `AgentEvent` model with 9 event types
- Foundry sub-agents stream via `responses.create(stream=True)`
- Thread-safe `queue.Queue` bridges events from worker threads
- CLI renderer with agent-specific icons (✈️ 🏨 🤖)

### ✅ Phase 6: Output Persistence (Complete)
- Markdown files per run: `output/{run_id}-result.md` + `output/{run_id}-document.md`
- Run metadata header (ID, timestamp, mode, query)
- Raw agent contributions preserved via pre-consolidation snapshot

### 🔜 Phase 7: Web UI
- FastAPI + SSE endpoint consuming the existing event stream
- React/Vue frontend with real-time agent activity visualization

---

## 8. Key References

| Resource | URL |
|----------|-----|
| Microsoft Agent Framework (GitHub) | https://github.com/microsoft/agent-framework |
| MAF Python Packages | `agent-framework-core`, `agent-framework-azure-ai` (install from git main branch) |
| Azure AI Foundry Agents Overview | https://learn.microsoft.com/en-us/azure/ai-foundry/agents/overview |
| Responses API (OpenAI) | https://platform.openai.com/docs/api-reference/responses |
| azure-ai-projects SDK | https://pypi.org/project/azure-ai-projects/ |

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MAF SDK is pre-release (installed from git main) | API may change | Pin to specific commit hash if needed; 49 tests catch regressions |
| Foundry agents require active Azure subscription | Cannot run without Azure | Unit tests use mocks; YAML definitions document agent contracts |
| Latency: orchestrator → Foundry round-trip per agent | 10-20s per sub-agent call | Streaming events provide real-time visibility; future parallel dispatch |
| `_inner_get_response` monkey-patch for reasoning logger | May break on MAF updates | Isolated in `attach_reasoning_logger()`; fallback: `ChatMiddleware` |
| Thread-based async bridging | Complexity in event propagation | Well-tested `queue.Queue` pattern; single responsibility per thread |

---

## 10. Success Criteria

- [x] User can ask a natural-language travel question and receive a synthesized plan
- [x] Facilitator correctly decomposes tasks and routes to specialist agents
- [x] Each sub-agent runs as a managed Foundry agent (Responses API, server-side conversations)
- [x] Solution is testable locally with mocked Foundry responses (49 tests passing)
- [x] Adding a new sub-agent requires only a YAML file (no code changes)
- [x] Reasoning phases (🧠) and tool decisions (🔧) are logged inline before tool execution
- [x] Real-time streaming events from sub-agents during execution
- [x] Output persisted as markdown files per run
- [x] End-to-end workflow completes in under 90 seconds for a dual-agent query
