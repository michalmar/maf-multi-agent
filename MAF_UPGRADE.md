# MAF Upgrade SOP

This runbook describes how to bump Microsoft Agent Framework (MAF) safely. The goal is to keep upgrades a bounded maintenance task, not an open-ended runtime migration.

## Current pin policy

MAF packages are pinned in `backend/pyproject.toml`.

Current packages:

- `agent-framework-core`
- `agent-framework-openai`
- `agent-framework-foundry`

When using git pins, all MAF packages must point to the same immutable commit SHA. If MAF publishes a stable PyPI release that covers the required packages, prefer a normal version pin or compatible-release constraint over git URLs.

## Upgrade checklist

1. Create a branch named for the target, for example `maf-upgrade-<version-or-sha>`.
2. Review MAF release notes or the target commit diff for package moves, renamed clients, middleware changes, MCP changes, and telemetry changes.
3. Update every MAF dependency in `backend/pyproject.toml` to the same target version or commit.
4. Refresh and install the lockfile:

   ```bash
   cd backend
   uv lock
   uv sync
   ```

5. Check for import/package split changes. Pay special attention to:

   - `backend/src/orchestrator.py`
   - `backend/src/scratchpad/workflow.py`
   - `backend/src/observability.py`
   - `backend/src/fabric_mcp_client.py`
   - `backend/tests/test_orchestrator.py`
   - `backend/tests/test_observability.py`
   - `backend/tests/test_fabric_mcp_client.py`

6. Re-run the targeted upgrade tests:

   ```bash
   cd backend
   .venv/bin/python -m pytest \
     tests/test_orchestrator.py \
     tests/test_observability.py \
     tests/test_fabric_mcp_client.py \
     tests/test_foundry_client.py \
     tests/test_contract_docs.py \
     -v
   ```

7. Re-run the full backend suite:

   ```bash
   cd backend
   .venv/bin/python -m pytest tests/ -v
   ```

8. Run a local end-to-end maintenance-style request with the frontend connected to the backend. Confirm:

   - `reasoning` events appear before their related tool activity.
   - `tool_decision` events are not duplicated.
   - specialist lifecycle events appear in order: `agent_started` -> document/task events -> `agent_completed` or `agent_error`.
   - Fabric MCP still uses the Easy Auth user token in ACA and `DefaultAzureCredential` only as local fallback.
   - Foundry Code Interpreter artifacts are extracted and rendered through `/api/files/...` links.

9. If instrumentation is enabled, verify startup logs. Foundry-native observability may fall back to standard OTEL if the managed identity lacks the required Foundry API permission; this is acceptable only when standard telemetry is still configured.
10. Update this runbook if the upgrade changes package names, required dependencies, event behavior, or validation commands.

## Acceptance criteria

- `backend/pyproject.toml` and `backend/uv.lock` agree on the MAF target.
- No private MAF or Azure SDK method is monkey-patched for reasoning capture.
- Full backend tests pass.
- A local end-to-end run confirms event ordering, no duplicate tool decisions, Fabric MCP dispatch, and artifact rendering.
- The PR notes the target MAF version/SHA and any required follow-up permission or deployment changes.
