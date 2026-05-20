# Specialist Dispatch Contract

This document defines what a specialist agent YAML file commits to and what the dispatcher guarantees when the facilitator calls `call_<agent>`.

## YAML definition contract

Specialists are loaded from `backend/agents/*.yaml` by `backend/src/agent_loader.py`.

Required common fields:

| Field | Contract |
| --- | --- |
| `name` | Stable tool/source identifier, for example `data_analyst_tool`. This becomes the generated dispatch tool name `call_<name>`. |
| `display_name` | Human-readable UI label. |
| `role` | Short functional role shown to users and included in orchestration context. |
| `description` | Capability description used by the facilitator to decide when to dispatch the specialist. |
| `task_description` | Describes the work the specialist should receive. It must not assume direct access to the full user request unless that context is included in the dispatch message or task text. |

Foundry specialists also provide `foundry_agent_name`. MCP specialists use `type: mcp`, `mcp_url_env`, `mcp_tool_name`, and optional `mcp_auth`.

`dispatch_instructions` are appended to the specialist prompt after task context. Keep them backend-specific and stable; do not put per-request data in YAML.

## Dispatch function signature

Every specialist is exposed to the facilitator as:

```text
call_<agent_name>(task_ids: str, message: str) -> str
```

- `task_ids` must be a JSON string containing an integer or an array of integers, for example `"[1, 2]"`.
- `message` should be brief. The dispatcher reads the actual task text from the `TaskBoard` and appends it to the specialist prompt.
- Invalid `task_ids` returns an `Error:` string rather than raising to the workflow.

## Prompt context guarantee

The dispatcher sends the specialist a prompt with this structure:

```text
<message>

Your assigned tasks:
- Task <id>: <task text>

Specialist-specific instructions:
<dispatch_instructions>

Please complete the assigned task with concrete evidence, source names, and any limitations. If data cannot be retrieved, explain the exact error or limitation.
```

The specialist may rely on:

- Assigned task IDs and task text being included for every found task ID.
- Its own YAML `dispatch_instructions` being included when present.
- The user identity token being passed to Fabric MCP specialists when ACA Easy Auth provides it.

The specialist must not rely on:

- Direct access to the `TaskBoard` or `SharedDocument`.
- A specific frontend view being open.
- Another specialist having completed unless the task text or dispatch message says so.

## Output contract

Specialists return plain text or Markdown. The dispatcher:

1. Writes the response to `SharedDocument.write_section(day=0, time_slot="general", agent=<agent_name>, content=<response>)`.
2. Marks requested task IDs complete.
3. Returns a short completion summary to the facilitator.

Specialist output should include concrete evidence, source names, limitations, and exact errors when data cannot be retrieved. It may include Markdown tables, lists, and links to generated artifacts.

## Backend-specific behavior

| Backend | Invocation | Streaming behavior | Completion data |
| --- | --- | --- | --- |
| Foundry Prompt Agent | `run_foundry_agent(project_endpoint, foundry_agent_name, task)` | Emits `agent_started`, `agent_streaming` deltas, and `agent_completed`. | `length`, `elapsed`, `result`, optional `usage`. |
| Fabric MCP Agent | `run_fabric_mcp(mcp_url_env, mcp_tool_name, task, user_token=...)` | Emits `agent_started`, one `agent_streaming` event with the full response, and `agent_completed`. | `length`, `elapsed`, `result`. |

`agent_streaming` is intentionally not sent over SSE today, so user-visible progress comes from lifecycle, task, document, and final output events.

## Error contract

- Specialist client failures emit `agent_error` when the lower-level client can emit one.
- The dispatch tool catches failures, marks requested tasks complete to avoid limbo, and returns `Error: specialist <DISPLAY> failed: <message>` to the facilitator.
- Specialists should express partial results and limitations in normal output whenever possible instead of failing the call.
