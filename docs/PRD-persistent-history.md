# PRD: Persistent Run History with Azure Blob Storage

> **Status:** Approved  
> **Author:** Architecture Review  
> **Date:** 2026-04-10  

---

## 1. Problem Statement

Run history in the MAF Multi-Agent system is currently stored on the **container's ephemeral filesystem** (`backend/output/{user}/{run_id}/session.json`). Every Azure Container Apps (ACA) redeployment, restart, or scaling event **permanently deletes all history**. This is unacceptable for enterprise use — users lose visibility into past analyses, cannot replay previous runs, and have no audit trail.

### Impact

- **Data loss on every deploy** — CI/CD pipeline (`deploy.sh`) updates the ACA container revision, wiping the `output/` directory
- **Data loss on restarts** — container crashes, platform maintenance, or manual restarts destroy history
- **No multi-replica support** — if the app scales beyond 1 replica, each container has its own isolated history
- **No audit trail** — no durable record of what was asked, what agents ran, or what results were produced
- **User frustration** — history disappears unpredictably, eroding trust in the platform

---

## 2. Goals

1. **Survive ACA lifecycle events** — history persists across redeploys, restarts, and scaling
2. **Zero data loss** — every completed run is durably stored
3. **Multi-replica safe** — works correctly when ACA scales to multiple containers
4. **Backward compatible** — existing API contract unchanged; frontend requires no modifications
5. **Graceful degradation** — falls back to local filesystem when blob storage is not configured (local dev)
6. **Cost efficient** — minimal Azure cost at current scale (~50-200 runs/day)
7. **Auth aligned** — reuse existing UAMI + `DefaultAzureCredential` pattern

### Non-Goals

- Full-text search across history (can be added later with a metadata index)
- Cross-region replication
- Real-time sync between replicas during a live run (live state stays in-memory)
- Migration of existing local history to blob (manual/script if needed)

---

## 3. Solution: Azure Blob Storage

### 3.1 Why Blob Storage

| Criterion | Blob Storage | Cosmos DB | PostgreSQL | Azure Files Mount |
|-----------|-------------|-----------|------------|-------------------|
| Cost | ~$0.02/GB/mo | ~$25+/mo | ~$40+/mo | ~$0.06/GB/mo |
| Code changes | Moderate | Moderate | Heavy | None |
| Multi-replica safe | ✅ | ✅ | ✅ | ❌ (lock contention) |
| Auth pattern reuse | ✅ UAMI | ✅ UAMI | ✅ UAMI | ❌ (mount config) |
| VNet compatible | ✅ (PE pattern exists) | ✅ | ✅ | Partial |
| Ops complexity | Low | Medium | High | Low |
| Query capability | Prefix listing | Rich SQL-like | Full SQL | Filesystem listing |

Blob Storage is the best fit: lowest cost, simplest ops, proven auth/VNet patterns already in the codebase (token store), and sufficient query capability for the primary access pattern (list by user, load by run ID).

### 3.2 Architecture

```
┌─────────────────────────────────────────────────────┐
│  Container App                                       │
│  ┌─────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │  supervisord │──│ Next.js    │──│ FastAPI      │ │
│  │              │  │ :3000      │  │ :8000        │ │
│  └─────────────┘  └────────────┘  └──────┬───────┘ │
│                                          │          │
│  Identity: UAMI (DefaultAzureCredential) │          │
└──────────────────────────────────────────┼──────────┘
                                           │
                    ┌──────────────────────▼───────────┐
                    │  Azure Storage Account            │
                    │  (history-dedicated or shared)    │
                    │                                   │
                    │  Container: "history"              │
                    │  ├── {user}/{run_id}/session.json │
                    │  ├── {user}/{run_id}/files/a.png  │
                    │  └── ...                          │
                    │                                   │
                    │  Container: "sandbox-files"        │
                    │  ├── chart.png                     │
                    │  └── ...                          │
                    │                                   │
                    │  Auth: UAMI → Storage Blob Data    │
                    │         Contributor RBAC           │
                    └───────────────────────────────────┘
```

### 3.3 Blob Layout

```
history/
  {sanitized_user_email}/
    {run_id}/
      session.json          # Full session snapshot (~10-500 KB)
      files/
        chart.png           # Code Interpreter output files
        data.csv
        ...
  __local__/                # Runs without user identity (local dev)
    {run_id}/
      session.json
      files/...

sandbox-files/              # Global sandbox file cache
  {filename}                # Deduplicated by filename
```

### 3.4 Data Model

The `session.json` schema is unchanged:

```json
{
  "run_id": "20260410-120000-abc123",
  "user_email": "user@contoso.com",
  "query": "Analyze sales data for Q1...",
  "timestamp": "2026-04-10T12:00:00",
  "status": "done",
  "agents": [
    {"name": "orchestrator", "display_name": "Orchestrator", "avatar": "🤖", ...}
  ],
  "events": [
    {"event_type": "workflow_started", "source": "orchestrator", "data": {...}, ...}
  ],
  "tasks": [
    {"id": 1, "text": "Analyze sales trends", "assigned_to": "data_analyst_tool", "finished": true}
  ],
  "documents": [
    {"version": 1, "content": "## Sales Analysis\n...", "action": "update"}
  ],
  "result": "## Final Analysis\n...",
  "stream_label": "Replay of run 20260410-120000-abc123"
}
```

---

## 4. API Contract (Unchanged)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/history` | GET | List saved session snapshots for the authenticated user |
| `/api/history/{run_id}` | GET | Load a complete session snapshot for replay |
| `/api/history/{run_id}` | DELETE | Delete a saved session and its files |

Response shapes for `HistoryItem` and `SessionSnapshot` remain identical. The frontend requires **zero changes**.

---

## 5. Implementation Design

### 5.1 `HistoryStore` Abstraction (`src/history_store.py`)

```python
class HistoryStore(Protocol):
    async def save_session(self, user_dir: str, run_id: str, snapshot: dict) -> None: ...
    async def save_file(self, user_dir: str, run_id: str, filename: str, data: bytes, content_type: str) -> None: ...
    async def list_sessions(self, user_dir: str | None) -> list[dict]: ...
    async def get_session(self, user_dir: str, run_id: str) -> dict | None: ...
    async def delete_session(self, user_dir: str, run_id: str) -> bool: ...
    async def get_file(self, user_dir: str, run_id: str, filename: str) -> tuple[bytes, str] | None: ...
```

Two implementations:

1. **`BlobHistoryStore`** — uses `azure.storage.blob.aio.BlobServiceClient` with `DefaultAzureCredential`
2. **`LocalHistoryStore`** — wraps current filesystem logic (backward compatibility for local dev)

Factory function selects based on `HISTORY_STORAGE_ACCOUNT_URL` env var presence.

### 5.2 Configuration

New env var in `Config`:

```python
history_storage_account_url: str = ""  # e.g. https://mafhistory.blob.core.windows.net
```

When empty, falls back to `LocalHistoryStore` (current behavior).

### 5.3 Lifecycle Management

Azure Blob Storage lifecycle management policy:
- Move blobs to **Cool** tier after 30 days
- Delete blobs after **90 days** (configurable via Terraform variable)

### 5.4 Error Handling

- Blob write failures log a warning and fall back to local filesystem write
- Blob read failures for history listing return an empty list (not 500)
- Individual session load failures return 404
- The app starts and functions normally even if the storage account is unreachable

---

## 6. Infrastructure Changes

### 6.1 New Terraform Resources

| Resource | Purpose |
|----------|---------|
| `azapi_resource.history_account` | Storage account (Standard_LRS, no shared key) |
| `azapi_resource.history_container` | Blob container `history` |
| `azapi_resource.sandbox_container` | Blob container `sandbox-files` |
| `azurerm_role_assignment.history_blob` | `Storage Blob Data Contributor` for UAMI |
| `azurerm_management_policy` (optional) | Lifecycle: cool after 30d, delete after 90d |
| ACA env var | `HISTORY_STORAGE_ACCOUNT_URL` |

### 6.2 VNet Integration

When `enable_vnet = true`:
- Private endpoint for the history storage account (reuses existing PE subnet + blob DNS zone)
- `publicNetworkAccess = Disabled`

### 6.3 New Terraform Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `history_storage_account_name` | string | `""` (auto-generated) | Override storage account name |
| `history_retention_days` | number | `90` | Auto-delete history after N days |

---

## 7. Migration Path

### From Local to Blob

1. Deploy new code with `HISTORY_STORAGE_ACCOUNT_URL` set
2. New runs automatically persist to blob
3. Old local history remains accessible until the next redeploy (when it would have been lost anyway)
4. Optional: one-time migration script to upload existing `output/` to blob

### Rollback

- Remove `HISTORY_STORAGE_ACCOUNT_URL` env var → app falls back to local filesystem
- No data loss in blob — it remains accessible for future re-enablement

---

## 8. Testing Strategy

- Unit tests: mock `BlobServiceClient` to test `BlobHistoryStore` save/list/get/delete
- Integration: `LocalHistoryStore` path tested via existing test suite (no regressions)
- Manual: deploy to ACA, run queries, redeploy, verify history survives

---

## 9. Security Considerations

- **No secrets** — auth via `DefaultAzureCredential` (UAMI in ACA, `az login` locally)
- **No shared key access** — `allowSharedKeyAccess = false` on the storage account
- **User isolation** — sessions stored under user-scoped prefixes; super-user can list all
- **TLS only** — `supportsHttpsTrafficOnly = true`
- **Private networking** — private endpoint when VNet is enabled
- **No PII in blob names** — email is sanitized for directory names (same as current)

---

## 10. Cost Estimate

| Component | Estimated Monthly Cost |
|-----------|----------------------|
| Blob Storage (hot, ~5 GB) | ~$0.10 |
| Transactions (~10K ops/day) | ~$0.15 |
| **Total** | **~$0.25/month** |

At scale (1000 runs/day, 50 GB): ~$2.50/month.

---

## 11. Success Criteria

1. ✅ History persists across ACA redeployment
2. ✅ History persists across container restarts
3. ✅ Frontend history panel works identically (no UI changes)
4. ✅ Local development works without Azure storage (filesystem fallback)
5. ✅ Existing tests pass without modification
6. ✅ Super-user cross-user history listing works
7. ✅ Sandbox files (charts, CSVs) persist and render in replays
