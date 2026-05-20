# Orchestrator Runtime Contract

This document defines the contract between the facilitator workflow, its tools, specialist dispatch, and the API/SSE layer. It complements the architecture overview in `AGENTS.md`.

## Scope

The orchestrator is the MAF `ChatAgent` created by `backend/src/scratchpad/workflow.py`. A run owns one in-memory `TaskBoard`, one `SharedDocument`, the facilitator tools, one generated `call_<agent>` dispatch tool per selected specialist, and optional mail tools.

## Run lifecycle

1. `POST /api/run` creates a `run_id`, starts `_run_workflow` in the background, and exposes events through `GET /api/stream/{run_id}`.
2. `run_scratchpad_workflow` emits `workflow_started`, creates scratchpad state, builds tools, renders `facilitator_prompt.jinja2`, and runs the facilitator.
3. The facilitator must create tasks before dispatching specialists, dispatch task IDs to matching specialists, review the shared document, consolidate sections when needed, then produce a final answer.
4. On success, the API emits the terminal `output` event with final result and document content, then sends the SSE `done` sentinel.
5. On unhandled workflow failure, the API emits `agent_error` with `source="orchestrator"` and ends the stream.

## Facilitator tool contract

| Tool | Input contract | Return contract | Failure behavior |
| --- | --- | --- | --- |
| `create_tasks` | `tasks` is a JSON string containing an array of objects with `text` and `assigned_to`. `assigned_to` must be a specialist YAML `name`. | Text summary with created task IDs. Emits `tasks_created`. | Malformed JSON or non-array input returns an `Error:` string to the model. Missing object keys are programming errors and may raise. |
| `get_plan_status` | No input. | Human-readable task completion summary. | No expected runtime failure. |
| `read_document` | No input. | Markdown-like document with `[agent]` attribution tags. | No expected runtime failure. |
| `consolidate_section` | `day` integer, `time_slot` one of `general`, `morning`, `afternoon`, `evening`, `night`, and replacement `content`. | Confirmation string. Emits `document_updated`. | Invalid `time_slot` raises and is surfaced as a tool error. |
| `read_document_clean` | No input. | Document text without `[agent]` attribution tags. | No expected runtime failure. |
| `send_email_to_user` | Registered only when mail is configured and user email is known. The facilitator should call it only when explicitly requested by the user. | Mail send status. | Mail errors are returned/surfaced through the tool; the UI answer still remains available. |
| `call_<agent>` | `task_ids` is a JSON string array of integer task IDs; `message` is short natural-language guidance. | Completion summary stating that results were written to the shared document. | Invalid `task_ids` returns an `Error:` string. Specialist call failure marks requested tasks complete as a safety net and returns an `Error:` string. |

## Task ID guarantees

- Task IDs are one-based, monotonically increasing integers scoped to a single run.
- `tasks_created` and `task_completed` events include a full task snapshot so consumers can reconstruct current state without calling back into the backend.
- The orchestrator must pass task IDs as a JSON string array to dispatch tools, for example `"[1, 2]"`.
- If a dispatch tool receives IDs that do not exist, it logs the missing IDs and sends only found tasks to the specialist.

## Document guarantees

- Specialists do not mutate the document directly. The dispatcher writes the returned specialist response to `day=0`, `time_slot="general"`, under the specialist agent name.
- Every document write or consolidation increments `SharedDocument.version` and emits `document_updated`.
- The first consolidation snapshots raw specialist contributions so the final run record can preserve pre-consolidation source material.
- Markdown returned by specialists may include sandbox artifact links; the API rewrites those links for SSE/history delivery.

## Event ordering guarantees

- Events are created synchronously at the point of the state transition they describe.
- Events emitted from worker threads are bridged back to the API event loop with `loop.call_soon_threadsafe`.
- `tool_decision` is emitted by supported MAF middleware immediately before the tool side effect starts.
- `agent_streaming` is an internal high-volume event. It is delivered to the in-process queue but intentionally filtered from SSE and run snapshots.

## Expected failure modes

- Specialist backend errors produce `agent_error` from the specialist client and an `Error:` return from the dispatch tool. The facilitator can continue with other specialists or explain the limitation.
- Orchestrator-level unhandled exceptions produce `agent_error` with `source="orchestrator"` and set the run status to `error`.
- History checkpoint failures are logged and do not fail the active workflow.
- Missing Fabric user token is not automatically fatal: Fabric MCP falls back to `DefaultAzureCredential` for local development, but Fabric data queries may reject non-user identity.
