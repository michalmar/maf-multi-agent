# PRD: Post-Run Recommended Actions

> **Status:** Draft  
> **Author:** Architecture Review  
> **Date:** 2026-05-04  

---

## 1. Problem Statement

The application currently completes a workflow by showing the final markdown result and final shared document in the Result and Document workspace tabs. Users can copy or download the result, but the application does not help them take the next operational step from the findings.

For maintenance and operations workflows, the final answer often implies follow-up actions such as notifying the user, opening a support ticket, or scheduling urgent maintenance. Today the user must manually copy text out of the result, switch tools, and recreate context. This breaks the agentic flow exactly when the analysis becomes actionable.

---

## 2. Goals

1. Present a compact set of recommended next actions after a run completes successfully.
2. Support three first-class actions:
   - Send the final result/document to the authenticated user's own inbox.
   - Create a support ticket from a prefilled draft based on the run result.
   - Schedule immediate maintenance for the affected asset, with higher visual priority than the ticket action.
3. Use mocked backend execution for all actions in the first implementation. The backend always returns success after request validation and ownership checks.
4. Keep the action experience available for both live completed runs and saved run replays.
5. Preserve existing workflow orchestration behavior. Post-run actions must not require the facilitator or specialist agents to run again.
6. Use existing authentication, history ownership, proxy, toast, and design-system patterns.
7. Persist action success state with the run snapshot so replayed sessions can show what was already submitted.

---

## 3. Non-Goals

1. Integrating with a real ticketing system, CMMS, maintenance scheduler, or Graph mail delivery in the MVP.
2. Asking the LLM to generate post-run actions after completion.
3. Changing the scratchpad workflow, agent prompts, task dispatching, or SSE event semantics.
4. Supporting arbitrary custom action types in the MVP.
5. Building cross-run action analytics or admin dashboards.
6. Sending actions on behalf of any user other than the authenticated run owner.

---

## 4. Current State

### 4.1 Backend

- Runs start through `POST /api/run`.
- Live progress streams through `GET /api/stream/{run_id}`.
- Final results are stored in `RunStore` and persisted into `session.json` through the `HistoryStore` abstraction.
- Completed results can be retrieved through `GET /api/result/{run_id}`.
- Saved sessions can be listed, loaded, and deleted through `/api/history`.
- History and result access already require trusted user identity from Easy Auth headers, with an explicit local-dev fallback.
- The app already has facilitator-driven email support through `MailTools`, `graph_mail_client.py`, and `MAIL_SENDER_ADDRESS`, but that path is controlled by the LLM during the workflow and is not a post-run user action.

### 4.2 Frontend

- `PlannerShell` owns run state, Easy Auth user state, toasts, live SSE handling, history replay, and the current workspace tab.
- `WorkspacePanels` renders the Activity, Tasks, Document, and Result tabs.
- The Result tab currently shows copy and download buttons plus rendered markdown.
- The app already uses route-handler proxies under `frontend/app/api/*` to forward requests to FastAPI while preserving trusted Easy Auth headers.
- `ToastContainer` provides success, error, and info notifications.

---

## 5. Proposed Solution

Add a post-run action system with two backend capabilities:

1. **Action suggestions** - For a completed run, the backend returns the three supported actions with draft payloads generated from the saved result/document.
2. **Action execution** - The frontend submits one action with optional user-edited payload. The backend validates the request, confirms run ownership, records a mocked success submission, and returns a success response.

On the frontend, add a `PostRunActions` component beneath the final Result markdown. It fetches suggested actions when the current run is completed, displays the actions as cards/buttons, opens an edit/confirmation modal for actions with draft text, executes the selected action, and displays success status inline plus a toast notification.

### 5.1 User-Facing Action Set

| Priority | Action | Primary user value | MVP behavior |
|----------|--------|--------------------|--------------|
| 1 | Schedule maintenance | Converts high-priority findings into an immediate maintenance request | Mock scheduler returns success with a `MNT-*` reference |
| 2 | Create support ticket | Captures the issue for support/operations follow-up | Mock ticketing API returns success with a `TCK-*` reference |
| 3 | Send email | Sends the final result to the authenticated user's inbox | Mock email API returns success with a `MSG-*` reference |

Maintenance is ranked above support ticket because it represents immediate operational intervention. If severity extraction finds `critical`, `high`, or `medium-high`, the maintenance card should be visually highlighted as the recommended action. If severity cannot be inferred, all actions remain available, but maintenance still appears first.

---

## 6. User Experience

### 6.1 Entry Point

After a run emits the final output and `status === "done"`, the Result tab renders:

1. Existing final response header.
2. Existing Copy and Download controls.
3. Existing markdown result surface.
4. New "Recommended next actions" panel.

The actions panel should not appear while a run is still running, when the result is empty, or when the run is in an error state.

### 6.2 Result Tab Layout

```text
Result
The orchestrator has produced a final response.                 [Copy] [Download]

+--------------------------------------------------------------------+
| # Final markdown result                                             |
| ...                                                                 |
+--------------------------------------------------------------------+

+--------------------------------------------------------------------+
| Recommended next actions                                            |
| Turn this finding into an operational follow-up.                    |
|                                                                    |
| +----------------------+ +----------------------+ +--------------+ |
| | Schedule maintenance | | Create support ticket | | Send email   | |
| | Immediate priority   | | Draft issue prepared  | | To your inbox| |
| | [Review & schedule]  | | [Review ticket]       | | [Review]     | |
| +----------------------+ +----------------------+ +--------------+ |
|                                                                    |
| Last action: Maintenance scheduled. Reference MNT-20260504-ABC123   |
+--------------------------------------------------------------------+
```

### 6.3 Action Review Modal

All actions open a modal before execution. This keeps the user explicitly in control and avoids accidental submissions.

#### Send Email

- Shows the resolved recipient email as read-only.
- Shows editable subject and body preview.
- Default subject: `Run result: {result_title_or_asset}`
- Default body: final result markdown converted to plain text or simple HTML in a later implementation. MVP can send/store markdown in the mock payload.
- Primary button: `Send email`

#### Create Support Ticket

- Shows editable title, priority, asset, and description.
- Default title: `{asset_id}: {severity} finding from agent analysis`
- Default priority:
  - `High` for critical/high/medium-high result language.
  - `Normal` otherwise.
- Default description includes:
  - Original query.
  - Health status or first summary paragraph.
  - Likely cause if extractable.
  - Recommended next action if extractable.
  - Link/reference to `run_id`.
- Primary button: `Create ticket`

#### Schedule Maintenance

- Shows editable asset, priority, requested timing, and work summary.
- Default timing: `Immediate / next available maintenance window`.
- Default priority:
  - `Urgent` for critical/high/medium-high result language.
  - `Normal` otherwise.
- Default work summary includes the recommended maintenance action and relevant safety caveat.
- Primary button: `Schedule maintenance`

### 6.4 Success Feedback

After a successful action submission:

- The clicked card changes to a success state.
- The returned confirmation message and reference ID are shown inline.
- A success toast is displayed.
- The modal closes.
- The action remains visible but indicates it has already succeeded.
- The user may submit the same action again only if they reopen the modal and explicitly confirm. In MVP, duplicate submissions are allowed because the mocked backend has no external side effects, but the UI should make prior submissions obvious.

### 6.5 Empty and Edge States

| State | UI behavior |
|-------|-------------|
| Run still running | Hide the action panel |
| Run errored | Hide the action panel |
| Completed run with no result | Hide the action panel |
| Backend unreachable while loading suggestions | Show compact inline error with retry |
| Action execution request fails validation | Show inline error plus error toast |
| Local mock replay | Show disabled action preview or omit actions to avoid 404s, because mock replay is not persisted in backend history |
| Saved replay | Fetch actions by `run_id` and show persisted submission state |

---

## 7. Backend Requirements

### 7.1 New Data Types

```python
ActionType = Literal[
    "send_email",
    "create_support_ticket",
    "schedule_maintenance",
]
```

```json
{
  "type": "schedule_maintenance",
  "label": "Schedule maintenance",
  "description": "Schedule immediate maintenance for COMP-001.",
  "priority": "urgent",
  "enabled": true,
  "draft": {
    "asset_id": "COMP-001",
    "priority": "Urgent",
    "requested_timing": "Immediate / next available maintenance window",
    "summary": "Inspect the cooler path and recycle valve before the next sustained high-load cycle."
  },
  "latest_submission": {
    "submission_id": "act_abc123",
    "reference_id": "MNT-20260504-ABC123",
    "status": "success",
    "message": "Maintenance scheduled for COMP-001.",
    "submitted_at": "2026-05-04T13:30:00.000000"
  }
}
```

### 7.2 Session Snapshot Extension

Extend `SessionSnapshot` with an optional `post_run_actions` object:

```json
{
  "post_run_actions": {
    "submissions": [
      {
        "submission_id": "act_abc123",
        "action_type": "schedule_maintenance",
        "reference_id": "MNT-20260504-ABC123",
        "status": "success",
        "message": "Maintenance scheduled for COMP-001.",
        "payload": {
          "asset_id": "COMP-001",
          "priority": "Urgent",
          "summary": "Inspect the cooler path and recycle valve before the next sustained high-load cycle."
        },
        "submitted_at": "2026-05-04T13:30:00.000000",
        "submitted_by": "user@example.com"
      }
    ]
  }
}
```

The field is optional for backward compatibility. Old snapshots without the field remain valid.

### 7.3 New FastAPI Endpoints

#### `GET /api/post-run-actions/{run_id}`

Returns available actions and drafts for a completed run.

Validation:

1. Validate `run_id` with the existing run ID rules.
2. Resolve authenticated user with the existing `_require_history_user_email` path.
3. Load active result or saved session using existing ownership-scoped helpers.
4. Require completed result text. If not ready, return `409`.
5. Generate deterministic action drafts from result, document, query, and run ID.
6. Include latest persisted submission per action type if present.

Example response:

```json
{
  "run_id": "20260504-132500-abc123",
  "status": "ready",
  "result_title": "COMP-001 maintenance brief",
  "actions": [
    {
      "type": "schedule_maintenance",
      "label": "Schedule maintenance",
      "description": "Schedule immediate maintenance for COMP-001.",
      "priority": "urgent",
      "enabled": true,
      "draft": {
        "asset_id": "COMP-001",
        "priority": "Urgent",
        "requested_timing": "Immediate / next available maintenance window",
        "summary": "Inspect the cooler path and recycle valve before the next sustained high-load cycle.",
        "run_id": "20260504-132500-abc123"
      }
    }
  ]
}
```

#### `POST /api/post-run-actions/{run_id}`

Executes a mocked action and persists the success submission.

Request:

```json
{
  "action_type": "create_support_ticket",
  "payload": {
    "title": "COMP-001: medium-high finding from agent analysis",
    "priority": "High",
    "asset_id": "COMP-001",
    "description": "Agent analysis found..."
  }
}
```

Response:

```json
{
  "success": true,
  "run_id": "20260504-132500-abc123",
  "action_type": "create_support_ticket",
  "submission_id": "act_8a4d2c",
  "reference_id": "TCK-20260504-8A4D2C",
  "message": "Support ticket TCK-20260504-8A4D2C created for COMP-001.",
  "submitted_at": "2026-05-04T13:31:00.000000"
}
```

Validation:

1. Same run ID, identity, ownership, and result-ready checks as the GET endpoint.
2. Validate `action_type` against the supported enum.
3. Validate payload shape for the selected action.
4. Enforce a payload size limit, recommended 50 KB.
5. Ignore any client-supplied recipient email. For email, recipient is always the authenticated user.
6. Return success after validation; no external service is called.

### 7.4 Draft Generation

The MVP should use deterministic extraction instead of an LLM:

| Field | Extraction strategy |
|-------|---------------------|
| Result title | First markdown `#` heading, fallback `Run {run_id}` |
| Asset ID | Regex for uppercase asset-like identifiers such as `COMP-001`, fallback `Current asset` |
| Severity | Case-insensitive scan for `critical`, `high`, `medium-high`, `medium`, `low` |
| Summary | First non-empty paragraph after `Health status`, `Executive summary`, or first non-heading paragraph |
| Likely cause | Text under `Likely cause`, fallback empty |
| Recommended action | Text under `Recommended next maintenance action`, `Recommended next step`, or first sentence containing `inspect`, `schedule`, `replace`, `reduce`, or `monitor` |

This keeps the action API fast, deterministic, testable, and independent from model availability.

### 7.5 Persistence

When an action is submitted:

1. Load the user's saved `session.json`.
2. Append a submission to `post_run_actions.submissions`.
3. Update `updated_at`.
4. Save the snapshot through `HistoryStore.save_session`.

If the saved snapshot is not yet available but the in-memory run result exists, return `409 Result snapshot not ready` rather than storing action state only in memory. This keeps action persistence consistent across local and Blob history stores.

### 7.6 Mock Reference IDs

Reference IDs should be recognizable and action-specific:

| Action | Prefix | Example |
|--------|--------|---------|
| Send email | `MSG` | `MSG-20260504-8A4D2C` |
| Create support ticket | `TCK` | `TCK-20260504-8A4D2C` |
| Schedule maintenance | `MNT` | `MNT-20260504-8A4D2C` |

---

## 8. Frontend Requirements

### 8.1 New Types

Add to `frontend/lib/types.ts`:

```typescript
export type PostRunActionType =
  | "send_email"
  | "create_support_ticket"
  | "schedule_maintenance";

export interface PostRunActionSubmission {
  submission_id: string;
  action_type: PostRunActionType;
  reference_id: string;
  status: "success";
  message: string;
  submitted_at: string;
}

export interface PostRunAction {
  type: PostRunActionType;
  label: string;
  description: string;
  priority: "normal" | "high" | "urgent";
  enabled: boolean;
  draft: Record<string, unknown>;
  latest_submission?: PostRunActionSubmission;
}

export interface PostRunActionsResponse {
  run_id: string;
  status: "ready";
  result_title: string;
  actions: PostRunAction[];
}
```

Also extend `SessionSnapshot` with optional `post_run_actions`.

### 8.2 New Next.js Proxy Route

Add `frontend/app/api/post-run-actions/[runId]/route.ts`.

Responsibilities:

- Validate `runId` with existing `validateRunId`.
- Forward trusted Easy Auth principal headers using `forwardAuthHeaders`.
- Support `GET` and `POST`.
- Parse and validate JSON body for `POST`.
- Use `safeFetch` and `safeJson`.
- Preserve upstream status codes.

### 8.3 New Components

| Component | Purpose |
|-----------|---------|
| `components/post-run-actions.tsx` | Fetches and renders action cards, manages loading/error/executing state |
| `components/post-run-action-modal.tsx` | Accessible modal for reviewing/editing draft payloads before execution |

The modal should follow the existing `WhatsNewModal` and `UsageDashboard` patterns:

- `AnimatePresence` + `motion.div`
- Backdrop closes modal
- Escape closes modal
- Focus moves into modal on open
- Focus returns to trigger on close
- `role="dialog"` and `aria-modal="true"`

### 8.4 Integration Points

1. `PlannerShell`
   - Pass `runSource` and an `onNotify` callback into `WorkspacePanels`, or pass a narrower `onActionSuccess/onActionError` callback.
   - Use existing `addToast` for action feedback.

2. `WorkspacePanels`
   - Render `PostRunActions` inside the Result tab when:
     - `status === "done"`
     - `Boolean(result)`
     - `runId` exists
     - `runSource !== "mock"`
   - Keep the existing copy/download behavior unchanged.

3. `mock-scenarios.ts`
   - No backend-backed action execution for local mock replay in MVP.
   - Optional UI-only disabled preview can be added if useful for visual testing.

### 8.5 Styling

Add CSS in `frontend/app/globals.css` using existing variables and button classes:

- `.post-run-actions`
- `.post-run-action-grid`
- `.post-run-action-card`
- `.post-run-action-card-priority`
- `.post-run-action-status`
- `.post-run-action-dialog`
- `.post-run-action-field`

Design should match the current panel/surface style:

- Use `panel-shell`, `workspace-surface`, `secondary-button`, and `action-button` conventions where possible.
- Use subtle accent border/background for the maintenance card.
- Avoid introducing a new design language.

---

## 9. API and Security Requirements

1. **Identity source** - Backend uses only trusted Easy Auth headers or existing explicit local-dev fallback. Client-provided email is ignored.
2. **Ownership** - Actions can only be generated or submitted for a run owned by the authenticated user, except configured super-user access should follow the same semantics as history replay.
3. **No client-trusted result content** - Backend loads result/document from the run snapshot. The client may submit edited action payloads, but not replace the canonical run result.
4. **Run ID validation** - Use existing run ID validation on both frontend proxy and backend endpoint.
5. **Payload size limit** - Reject oversized payloads with `400`.
6. **No secrets in logs** - Log action type, run ID, reference ID, and user; do not log full payload body.
7. **No external side effects in MVP** - Mock execution must not call Graph, ticketing, scheduler, or other external systems.
8. **Persistence scope** - Action submissions are stored with the user's session snapshot and inherit the same retention behavior as run history.

---

## 10. Error Handling

| Case | Backend status | Frontend behavior |
|------|----------------|-------------------|
| Missing identity | `401` | Show inline error and toast |
| Invalid run ID | `400` | Show inline error and toast |
| Run not found or not owned | `404` | Show "Actions unavailable for this run" |
| Result not ready | `409` | Show retry option |
| Unsupported action type | `400` | Show inline error |
| Invalid payload | `400` | Keep modal open and show validation message |
| Backend unreachable | `502` or `504` from proxy | Show retry option and toast |

Although mock execution always succeeds, validation and ownership errors should still fail closed.

---

## 11. Telemetry and Audit

MVP telemetry is limited to application logs and persisted action submissions.

Backend log fields:

- `run_id`
- `action_type`
- `reference_id`
- `submitted_by`
- `status`

Persisted action submissions are the user-visible audit trail. They are available when reopening the run from history.

---

## 12. Testing Strategy

### 12.1 Backend Tests

Add tests in `backend/tests/test_api.py` or a dedicated `test_post_run_actions.py`:

1. `GET /api/post-run-actions/{run_id}` requires identity.
2. GET rejects invalid run IDs.
3. GET returns 404 for another user's run.
4. GET returns 409 for missing/incomplete result.
5. GET returns all three action types for a completed run.
6. Draft generation extracts asset ID, severity, result title, and recommended maintenance text from a markdown result.
7. POST requires identity and owner scope.
8. POST rejects unsupported action types.
9. POST rejects oversized payloads.
10. POST returns success and an action-specific reference ID.
11. POST persists `post_run_actions.submissions` to the session snapshot.
12. Latest submission appears in a subsequent GET response.

### 12.2 Frontend Tests

Add Vitest coverage where practical:

1. Proxy route validates run ID and forwards only trusted auth headers.
2. `PostRunActions` hides itself when run is running, errored, missing result, or local mock.
3. `PostRunActions` renders three cards from API response.
4. Modal opens with draft text.
5. Successful POST displays inline success and triggers notification callback.
6. Failed POST keeps modal open and displays error.

### 12.3 Manual QA

1. Complete a live run and verify actions appear below the result.
2. Execute each action and verify success toast, inline status, and reference ID.
3. Reload the run from History and verify persisted action status remains visible.
4. Verify another user cannot fetch or execute actions for the run.
5. Verify local mock replay does not make backend action calls.
6. Verify keyboard accessibility for modal open, close, Escape, and focus return.
7. Verify daybreak and night themes.

---

## 13. Acceptance Criteria

1. A completed live run with a final result shows a "Recommended next actions" panel on the Result tab.
2. The panel shows Send email, Create support ticket, and Schedule maintenance actions.
3. Schedule maintenance appears before and/or more prominently than Create support ticket.
4. Each action opens a user-confirmation modal with prefilled content derived from the run result.
5. The user can edit ticket and maintenance draft text before submitting.
6. Backend action execution is mocked and always returns success after validation.
7. Success response includes a human-readable message and reference ID.
8. Frontend displays success status inline and through a toast.
9. Action submissions are persisted in the run snapshot and visible when reopening the run from History.
10. Actions are not available before the run completes, for errored runs, or for runs without a final result.
11. Run ownership and trusted identity rules match existing history/result endpoints.
12. Existing copy/download, history replay, SSE streaming, and workflow behavior remain unchanged.

---

## 14. Implementation Plan

### Phase 1 - Backend API and Persistence

1. Add Pydantic models for post-run action suggestions, execution requests, and responses.
2. Add deterministic draft-generation helpers.
3. Add helper to load completed run snapshots with existing user scoping.
4. Add `GET /api/post-run-actions/{run_id}`.
5. Add `POST /api/post-run-actions/{run_id}` with mock execution and snapshot persistence.
6. Add backend tests.

### Phase 2 - Frontend Proxy and Types

1. Add `PostRunAction*` types in `frontend/lib/types.ts`.
2. Add `app/api/post-run-actions/[runId]/route.ts` for GET/POST proxying.
3. Add proxy tests.

### Phase 3 - Frontend UX

1. Add `PostRunActions` and `PostRunActionModal`.
2. Wire the component into the Result tab in `WorkspacePanels`.
3. Pass notification callback from `PlannerShell`.
4. Add CSS matching the existing workspace style.
5. Add frontend component tests where practical.

### Phase 4 - Documentation and Release Notes

1. Update `CHANGELOG.md` when implementation ships because this is user-visible behavior.
2. Update README only if endpoint behavior or mocked-vs-real action behavior needs operator documentation.

---

## 15. Future Enhancements

1. Replace mock email execution with the existing Graph mail client when `MAIL_SENDER_ADDRESS` is configured.
2. Add real ticketing integration through ServiceNow, Azure DevOps, GitHub Issues, or another configured provider.
3. Add real maintenance scheduling integration with CMMS/EAM systems.
4. Use an LLM or structured extraction model for richer drafts once deterministic extraction is insufficient.
5. Add policy-based action availability, for example only show maintenance scheduling when severity is high.
6. Add organization-level audit/reporting for submitted actions.
7. Add action webhooks or event stream notifications for downstream systems.

---

## 16. Open Questions

1. Should duplicate submissions be allowed after MVP, or should each action be single-submit per run?
2. Which external support-ticket fields will be required by the eventual real integration?
3. Which maintenance scheduling fields will be required by the eventual real CMMS/EAM integration?
4. Should the existing facilitator-driven email tool remain long term, or should email delivery move entirely to explicit post-run actions?
5. Should post-run action drafts be included in exported/downloaded result packages in the future?
