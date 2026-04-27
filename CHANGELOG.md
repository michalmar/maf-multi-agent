# Changelog

All notable changes to the MAF Multi-Agent app are documented here.
Update this file with every merge/commit to the main branch.

## [2026-04-27] — Quality & Documentation Cleanup

### Added
- **Frontend test harness** — Vitest coverage now exercises theme hydration and API proxy validation.
- **Backend edge tests** — API and sandbox artifact tests now cover unsafe run IDs, active-result ownership, missing file keys, and disk fallback.

### Changed
- **Theme hydration** — The React theme hook now starts from the bootstrap DOM theme or saved preference, avoiding day/night flicker.
- **Current project docs** — README and Python package metadata now describe the MAF multi-agent operations app instead of the original travel demo.

## [2026-04-27] — Security & Deployment Hardening

### Changed
- **History access requires identity** — Saved history, result replay, and deletion now require authenticated user context unless explicit local-dev anonymous mode is enabled.
- **Run identity is server-derived** — The run proxy strips client-supplied email identity, and the backend derives email behavior only from trusted Easy Auth headers or gated local-dev fallbacks.
- **Telemetry is opt-in** — Azure Monitor/OpenTelemetry setup is disabled by default and controlled by `ENABLE_INSTRUMENTATION` / `enable_instrumentation`.
- **SSE uses the proxy** — Live browser streams now connect through the Next.js stream proxy instead of bypassing it with a public backend URL.

### Fixed
- **Sandbox artifact collisions** — Downloaded Code Interpreter files now use content-addressed unique file keys instead of basename-only storage.
- **Terraform plan hygiene** — Terraform plan outputs are ignored, the tracked plan artifact was removed, and Terraform is configured for an Azure Storage backend.
- **Pinned container inputs** — Docker build stages now use explicit Python, Node, and uv versions instead of floating tags.

## [2026-04-21] — Resumable Background Runs

### Added
- **Running-session checkpoints** — Active runs now persist their latest status, timeline events, task board state, document drafts, and final result while they execute, so users can return to them from History without keeping the original tab open.

### Changed
- **History can reopen active runs** — Loading a still-running session from History now restores it into the live workspace and keeps refreshing progress from saved checkpoints until it finishes.
- **Result retrieval fallback** — Completed results can now be served from persisted session snapshots even after the in-memory live run state has been cleaned up.

### Fixed
- **SSE disconnect recovery** — Losing the live event stream no longer marks the run itself as failed; the UI falls back to background checkpoint refresh instead.
- **Stream reconnect cleanup** — Backend stream ownership is now released when a client disconnects, allowing later reconnects instead of leaving the run locked to a dead SSE session.

## [2026-04-10] — Persistent Run History

### Added
- **Durable history storage** — Run history now persists in Azure Blob Storage, surviving ACA redeploys and restarts. Set `HISTORY_STORAGE_ACCOUNT_URL` or enable `enable_history_storage` in Terraform.
- **Usage Dashboard** — New 📊 button in the header opens a modal dashboard with KPI cards (total runs, today, success rate), daily activity bar chart, status breakdown, per-user usage (super-user), and recent runs list. All data is computed client-side from the existing history API.
- **Token usage tracking** — Each session now records per-agent and per-model token usage breakdown (input, output, cached, reasoning tokens). Displayed in the Usage Dashboard with aggregate KPIs, agent/model bar charts, and token type distribution.
- **Automatic lifecycle management** — History blobs are moved to cool tier after 30 days and auto-deleted after 90 days (configurable via `history_retention_days`).
- **Terraform provisioning** — New `enable_history_storage` variable creates the storage account, blob container, RBAC role, lifecycle policy, and private endpoint (when VNet is enabled).

### Changed
- **History API refactored** — `GET/DELETE /api/history` endpoints now use a `HistoryStore` abstraction that selects Blob Storage or local filesystem based on configuration. API contract unchanged — no frontend changes needed.

## [2026-04-10] — Activity Feed Readability

### Changed
- **Redesigned live activity panel** — Timeline feed now uses the same bordered container with gradient background as the result pane, making text much easier to read.
- **Larger, higher-contrast text** — Summary text bumped from secondary to primary color with increased font size and multi-line display instead of single-line truncation.
- **Improved expanded details** — Expanded event cards now render inside a bordered surface card with better spacing and larger code blocks.
- **Subtler timeline line** — Vertical connector thinned and softened for a cleaner look.
- **Swimlane view polish** — Swim-lane container now matches the same surface treatment as the timeline view.

## [2026-04-01] — User Authentication & Onboarding

### Added
- **Security groups for access control** — Terraform now creates `{app_name}-App-Users` and `{app_name}-Data-Users` Entra ID security groups. Only assigned users can log in (`appRoleAssignmentRequired = true`).
- **User onboarding script** (`deploy/add_user.sh`) — Automates adding/removing users to security groups. Supports `--app-only`, `--data-only`, and `--remove` flags.
- **Token diagnostics** — Backend now logs JWT claim details (audience, scopes, UPN) for Fabric MCP calls to aid troubleshooting.
- **`allowedAudiences` validation** — Easy Auth config now validates token audiences for defense-in-depth.

### Changed
- **Enterprise App now requires user assignment** — Previously any tenant user could log in. Now only members of the App-Users group have access.

### Fixed
- **Terraform state drift** — Added `mail_sender_address` to `terraform.tfvars.example` to prevent untracked env var removal.

## [2026-03-30] — Scratchpad Pattern & Multi-Agent Orchestration

### Added
- **Scratchpad orchestration pattern** — Facilitator agent communicates with specialists via shared TaskBoard and SharedDocument instead of direct message passing.
- **Real-time SSE streaming** — All agent events streamed to frontend via Server-Sent Events with 15s keepalive.
- **Fabric Data Agent integration** — MCP-based agent with Easy Auth user token passthrough for OBO SQL queries.
- **Agent auto-discovery** — YAML-based agent definitions in `agents/` directory, auto-loaded by `agent_loader.py`.

## [2026-03-25] — Initial Release

### Added
- **MAF Multi-Agent Framework** — FastAPI backend with Azure AI Foundry orchestration.
- **Next.js Mission Control UI** — Real-time dashboard with agent roster, task board, and workspace panels.
- **Foundry Prompt Agents** — CoderData, WebSearch, KB agents via Azure AI Foundry Responses API.
- **Easy Auth integration** — ACA-based Entra ID authentication with token store.
- **Terraform IaC** — Full infrastructure as code for ACA, ACR, managed identity, Easy Auth.
