# Changelog

All notable changes to the MAF Multi-Agent app are documented here.
Update this file with every merge/commit to the main branch.

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
