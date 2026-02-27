# Orchestrator + Scratchpad Multi-Agent Pattern

## Overview

This document describes a **Plan-and-Dispatch orchestration pattern** where a Facilitator agent coordinates a team of specialist agents by:
1. Decomposing a user request into tasks on a shared **TaskBoard** (the "plan")
2. Dispatching specialists as LLM tool calls to work on those tasks
3. Having specialists write results into a shared **SharedDocument** (the "board / scratchpad")
4. Consolidating and reviewing the document before producing a final answer

The pattern is domain-agnostic. The travel planning use-case here is illustrative — the same structure applies to any multi-agent workflow that benefits from explicit task assignment and a shared collaborative workspace.

---

## Architecture

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  Facilitator Agent                                          │
│                                                             │
│  Tools:                                                     │
│  ├─ FacilitatorTools (scratchpad management)                │
│  │   ├─ create_tasks        → writes to TaskBoard           │
│  │   ├─ get_plan_status     → reads TaskBoard               │
│  │   ├─ read_document       → reads SharedDocument (tagged) │
│  │   ├─ consolidate_section → merges SharedDocument slot    │
│  │   └─ read_document_clean → reads SharedDocument (clean)  │
│  │                                                          │
│  └─ AgentDispatcher (specialist dispatch as tools)          │
│      ├─ call_specialist_a(task_ids, message) → run_agent()  │
│      ├─ call_specialist_b(task_ids, message) → run_agent()  │
│      └─ call_specialist_c(task_ids, message) → run_agent()  │
└──────────────┬──────────────────────────────────────────────┘
               │ (shared by reference)
               ▼
       ┌───────────────┐       ┌──────────────────┐
       │   TaskBoard   │       │  SharedDocument   │
       │  (the plan)   │       │  (the scratchpad) │
       └───────────────┘       └──────────────────┘
               ▲                        ▲
               │                        │
┌──────────────┴────────────────────────┴──────────────┐
│  Specialist Agent (run_agent)                        │
│                                                      │
│  Tools (SpecialistTools):                            │
│  ├─ read_tasks          → reads TaskBoard            │
│  ├─ complete_task       → updates TaskBoard          │
│  ├─ read_document       → reads SharedDocument       │
│  └─ write_section       → appends to SharedDocument  │
└──────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. TaskBoard — The Plan

The `TaskBoard` is a lightweight in-memory list of `Task` objects with ID, text, assignee, and `finished` flag.

**Role separation:**
- **Facilitator** *creates* tasks (via `create_tasks` tool)
- **Specialists** *read and complete* tasks (via `read_tasks` / `complete_task` tools)

**Key design choices:**
- Tasks are assigned to named agents (e.g. `"logistics"`, `"food"`) — not to specific instances
- The facilitator passes `task_ids` explicitly when dispatching an agent, so each specialist knows exactly what to work on without scanning all tasks
- The facilitator calls `get_plan_status` after each dispatch batch to check progress before moving on
- If a specialist forgets to call `complete_task`, the orchestrator auto-completes assigned tasks after the agent finishes (safety net, logged as a warning)

### 2. SharedDocument — The Scratchpad / Board

The `SharedDocument` is a slot-based collaborative workspace structured as:

```
document
  └── day (int, 0 = general)
        └── time_slot (general | morning | afternoon | evening | night)
              └── list[SlotEntry(agent, content, timestamp)]
```

**Role separation:**
- **Specialists** *append* entries (`write_section`) — multiple agents can write to the same slot, entries are accumulated as candidates
- **Facilitator** *consolidates* slots (`consolidate_section`) — replaces all candidate entries in a slot with a single merged version

**Key design choices:**
- Append semantics for specialists avoid write conflicts (no locking needed)
- Agent tags (`[agent_name]`) are visible to the facilitator during consolidation so it knows the provenance of each entry
- Clean render (no tags) is used for the final output to the user
- Versioned history allows the UI to animate changes as they happen

### 3. Facilitator Agent

The Facilitator is a standard LLM agent whose tool list is the **union** of `FacilitatorTools` and `AgentDispatcher`. It never directly calls the LLM on behalf of specialists; instead each specialist dispatch is a regular tool call that blocks until the specialist finishes.

**Workflow (encoded in the system prompt):**

| Step | Action | Tools used |
|------|--------|-----------|
| 1 | Decompose request into tasks, assign to specialists | `create_tasks` |
| 2 | Dispatch specialists (can be parallel) | `call_<specialist>` |
| 2a | After each batch, check progress | `get_plan_status` |
| 2b | If tasks still pending, dispatch more agents | repeat step 2 |
| 3 | Review the scratchpad | `read_document` |
| 3a | Merge multi-entry slots | `consolidate_section` |
| 3b | If gaps found, create follow-up tasks and loop back to step 2 | `create_tasks` |
| 4 | Final review and present answer | `read_document_clean` |

### 4. AgentDispatcher — Specialists as Tools

Each specialist is exposed to the Facilitator as an `@tool`-decorated async method. This means the LLM decides *when* to invoke each specialist and *which task IDs* to pass.

```python
@tool
async def call_logistics_agent(
    self,
    task_ids: list[int],   # Facilitator picks which tasks to send
    message: str,          # Short natural-language instruction
) -> str:                  # Returns specialist's response summary
    return await run_agent("logistics", message, task_ids, ...)
```

**Key design choices:**
- The Facilitator can dispatch multiple specialists in a single LLM turn (parallel tool calls) because they write to different document slots
- The tool returns a text summary of what the specialist accomplished, giving the Facilitator feedback without reading the full document
- Dispatch tools have a `call_` prefix so the Facilitator's event emitter can skip emitting UI events for them (specialist agents emit their own events)

### 5. Specialist Agents

Each specialist is a fresh `Agent` instance created at dispatch time with:
- Its own `AgentThread` (no shared conversation history with the Facilitator)
- `SpecialistTools` bound to the shared `TaskBoard` and `SharedDocument`
- A domain-specific system prompt

**Key design choices:**
- Stateless per-invocation: fresh thread each time, so the Facilitator's conversation is not polluted
- "Stay in your lane" enforced by system prompt: each specialist only writes content within its domain, keeping the shared document well-organized
- `assigned_task_ids` are injected into `SpecialistTools` at construction time as a guardrail — if an agent tries to `complete_task` with a wrong ID, it is auto-corrected to its actual assigned task

---

## Data Flow — Step by Step

```
1. run_workflow(user_message)
   ├─ Create TaskBoard + SharedDocument (empty)
   ├─ Build FacilitatorTools + AgentDispatcher (both get refs to TaskBoard + SharedDocument)
   └─ Run Facilitator agent (streaming)

2. Facilitator LLM → tool call: create_tasks([...])
   └─ TaskBoard.create_tasks() → tasks [1,2,3,4,5,6,...]
      └─ emit "tasks_created" → UI

3. Facilitator LLM → parallel tool calls:
   ├─ call_logistics_agent(task_ids=[1,2], message="Work on tasks 1 and 2")
   │   └─ run_agent("logistics", ...)
   │       ├─ emit "agent_started"
   │       ├─ Logistics Agent runs with SpecialistTools
   │       │   ├─ read_tasks([1,2])        → TaskBoard.read_tasks()
   │       │   ├─ write_section(day=0, "general", "...", "logistics")
   │       │   │   └─ SharedDocument.write_section() → emit "document_updated"
   │       │   └─ complete_task(1), complete_task(2)
   │       │       └─ TaskBoard.complete_task() → emit "task_updated"
   │       ├─ emit "agent_message"
   │       └─ emit "agent_finished"
   │
   └─ call_food_agent(task_ids=[3,4], message="Work on tasks 3 and 4")
       └─ run_agent("food", ...) → [same flow]

4. Facilitator LLM → tool call: get_plan_status()
   └─ TaskBoard.get_all_tasks() → "3/6 done, tasks 5,6 pending"

5. Facilitator dispatches remaining agents ... (loop back to step 3)

6. Facilitator LLM → tool call: read_document()
   └─ SharedDocument.render(show_agent_tags=True)
      Returns: "[logistics] ...\n[food] ...\n[sightseeing] ..."

7. Facilitator LLM → tool call: consolidate_section(day=1, time_slot="morning", content="merged...")
   └─ SharedDocument.consolidate_section() → emit "document_updated"

8. Facilitator LLM → tool call: read_document_clean()
   └─ SharedDocument.render(show_agent_tags=False)

9. Facilitator LLM → final text response → emit "final_answer"

10. run_workflow finally block:
    └─ emit "workflow_finished" {tasks: [...], document_versions: [...]}
```

---

## Scratchpad Pattern Summary

The pattern uses **two distinct scratchpad types** with complementary roles:

| | TaskBoard | SharedDocument |
|---|---|---|
| **Purpose** | Work coordination | Content collaboration |
| **Written by** | Facilitator | Specialists (+ Facilitator for merges) |
| **Read by** | Facilitator + Specialists | Facilitator + Specialists |
| **Write semantics** | Assign / complete (state machine) | Append (accumulate candidates) |
| **Merge step** | N/A | Facilitator consolidates slots |
| **Visibility** | Full status (all agents can see all tasks) | Tagged entries (agent provenance visible) |

---

## Prompt Engineering Considerations

- **Facilitator system prompt** encodes the 4-step workflow explicitly (plan → dispatch → consolidate → review). Without explicit step ordering, LLMs tend to skip steps.
- **"Keep messages to agents SHORT — reference task IDs"**: long Facilitator→specialist messages waste tokens; the task text on the TaskBoard is the source of truth.
- **"Stay in your lane"** in specialist prompts prevents overlapping contributions and keeps the document organized.
- **Language mirroring**: the Facilitator is instructed to match the user's language and propagate that instruction to specialists via the dispatch message.
- **Task count guardrail** ("not more than 20"): prevents the Facilitator from over-decomposing, which leads to excessive agent calls.

---

## Adapting to a New Domain

To re-implement this pattern in a different project:

1. **Define your specialists** — identify 2–5 domain experts (e.g. `"researcher"`, `"writer"`, `"reviewer"`). Add them to `AGENT_CONFIGS` and write their system prompts.

2. **Define your scratchpad structure** — replace `SharedDocument`'s day/time-slot structure with whatever makes sense (e.g. sections, chapters, categories). Keep the append + consolidate semantics.

3. **Keep TaskBoard as-is** — it is already domain-agnostic. Only the `assigned_to` values need to match your specialist names.

4. **Wire `AgentDispatcher`** — add one `@tool call_<specialist>` method per specialist, all delegating to `run_agent()`.

5. **Update the Facilitator prompt** — describe your team and the 4-step workflow. The step structure (plan → dispatch → consolidate → review) is reusable verbatim.

6. **Keep `SpecialistTools` as-is** — `read_tasks`, `complete_task`, `read_document`, `write_section` are generic. Only the `write_section` slot structure needs updating to match your `SharedDocument`.

---

## Event Stream (UI Integration)

Events emitted during the workflow allow the frontend to render live progress:

| Event | Emitted by | Payload |
|-------|-----------|---------|
| `workflow_started` | orchestrator | `{message}` |
| `tasks_created` | FacilitatorTools | `{tasks: [{id, text, assigned_to}]}` |
| `agent_started` | run_agent | `{agent, display_name, task_ids, message}` |
| `tool_call` | orchestrator / run_agent | `{agent, tool, result, phase: "complete"}` |
| `task_updated` | SpecialistTools | `{id, text, assigned_to, finished}` |
| `document_updated` | SpecialistTools / FacilitatorTools | `{version, author, content, change_description}` |
| `agent_message` | run_agent | `{agent, display_name, content}` |
| `agent_finished` | run_agent | `{agent, display_name}` |
| `facilitator_message` | orchestrator | `{agent, display_name, content}` |
| `final_answer` | orchestrator | `{content}` |
| `workflow_finished` | orchestrator | `{tasks, document_versions}` |
| `error` | orchestrator | `{message}` |
