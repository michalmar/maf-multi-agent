# Changelog

All notable changes to the MAF Multi-Agent app are documented here.
Update this file with every merge/commit to the main branch.

## [2026-04-10] — Persistent Run History

### Added
- **Durable history storage** — Run history now persists in Azure Blob Storage, surviving ACA redeploys and restarts. Set `HISTORY_STORAGE_ACCOUNT_URL` or enable `enable_history_storage` in Terraform.
- **Usage Dashboard** — New 📊 button in the header opens a modal dashboard with KPI cards (total runs, today, success rate), daily activity bar chart, status breakdown, per-user usage (super-user), and recent runs list. All data is computed client-side from the existing history API.
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
