# Event Stream Contract

This document is the source of truth for `AgentEvent` values emitted by `backend/src/events.py` and consumed by the API, history store, and frontend.

## Envelope

Every event has this serialized shape:

```json
{
  "event_type": "workflow_started",
  "source": "orchestrator",
  "data": {},
  "timestamp": 1779280000.0,
  "event_summary": ""
}
```

| Field | Contract |
| --- | --- |
| `event_type` | One of the documented `EventType` values below. |
| `source` | Stable emitter name: `orchestrator`, `taskboard`, `document`, or a specialist YAML `name`. |
| `data` | Event-specific JSON object. Consumers must ignore unknown keys. |
| `timestamp` | Unix timestamp in seconds from backend event creation time. |
| `event_summary` | Optional one-sentence summary generated for selected event types. Empty string means no generated summary. |

## Delivery and persistence

- Backend logger records every event except `agent_streaming`.
- Active SSE streams send every event except `agent_streaming`, plus a final non-`AgentEvent` sentinel: `{"event_type":"done"}`.
- Run snapshots persist every event except `agent_streaming`.
- History replay returns persisted events with artifact URLs rewritten to run-scoped history URLs.
- Frontend state updates depend on `tasks_created`, `task_completed`, `document_updated`, `output`, `workflow_completed`, and orchestrator-scoped `agent_error`.
- The activity feed can render all known event types and falls back to raw JSON for unknown event data.
- `SummaryService` may enrich `workflow_started`, `reasoning`, `tool_decision`, and `output`.

## Event types

| EventType | Value | Source | Data contract | Primary consumers |
| --- | --- | --- | --- | --- |
| `WORKFLOW_STARTED` | `workflow_started` | `orchestrator` | `query: string` | Summary service, activity feed, run snapshots |
| `WORKFLOW_COMPLETED` | `workflow_completed` | `orchestrator` | `elapsed: number`, `tasks_completed: string`, `document_version: number`, `response_length: number`, optional `usage`, optional `summary_usage` | Planner status, activity feed, run snapshots |
| `REASONING` | `reasoning` | `orchestrator` | `iteration: number`, `text: string` | Summary service, activity feed, run snapshots |
| `TOOL_DECISION` | `tool_decision` | `orchestrator` | `iteration: number`, `tool: string`, `arguments: string` | Summary service, activity feed, run snapshots |
| `OUTPUT` | `output` | `orchestrator` | During orchestrator tracing: `iteration: number`, `text: string`. Terminal API event: `text: string`, `document: string`. | Planner result/document state, summary service, activity feed, run snapshots |
| `TASKS_CREATED` | `tasks_created` | `taskboard` | `tasks: TaskItem[]`, full task snapshot | Planner task list, activity feed, run snapshots |
| `TASK_COMPLETED` | `task_completed` | `taskboard` | `task_id: number`, `tasks: TaskItem[]`, full task snapshot | Planner task list, activity feed, run snapshots |
| `AGENT_STARTED` | `agent_started` | Specialist YAML `name` | `agent_name: string` | Agent status, swimlanes, activity feed |
| `AGENT_STREAMING` | `agent_streaming` | Specialist YAML `name` | Foundry: `delta: string`; Fabric MCP: `delta: string` containing the full response. | Internal queue only; filtered from SSE and snapshots |
| `AGENT_COMPLETED` | `agent_completed` | Specialist YAML `name` | `length: number`, `elapsed: number`, `result: string`, optional `usage` | Agent status, activity feed, run snapshots |
| `AGENT_ERROR` | `agent_error` | Specialist YAML `name` or `orchestrator` | `error: string`, optional `elapsed: number` | Error banner when `source="orchestrator"`, agent status, activity feed, run snapshots |
| `DOCUMENT_UPDATED` | `document_updated` | `document` | `version: number`, `content: string`, `history: { version: number, author: string, action: "write" \| "consolidate", day: number, time_slot: string }` | Planner document versions, activity feed, run snapshots |

`TaskItem` has this shape:

```json
{
  "id": 1,
  "text": "Investigate compressor telemetry",
  "assigned_to": "data_analyst_tool",
  "finished": false
}
```

## Compatibility rules

- Additive `data` fields are allowed. Consumers must ignore fields they do not understand.
- Removing or renaming an `EventType` value is a breaking change and requires updating backend tests, frontend `EventType`, mock scenarios, and this document.
- If a new `EventType` is added to `backend/src/events.py`, CI must fail until it is documented in this file.
- High-volume events should be filtered explicitly in the API layer rather than omitted at the emitter; this preserves the option to expose them later.
