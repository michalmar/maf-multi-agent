# PRD: Azure Container App VNet Integration

> **Status:** Draft — Review & Discussion  
> **Author:** Architecture Review  
> **Date:** 2026-04-10  

---

## 1. Problem Statement

The MAF Multi-Agent system currently runs on Azure Container Apps (ACA) **without VNet integration**. The ACA Container App Environment is deployed into a Microsoft-managed VNet with public egress. All backend service-to-service communication (Azure AI Foundry, Fabric MCP, Microsoft Graph, ARM API, Application Insights) goes over the public internet.

**The primary driver** is the Easy Auth **token store** — an Azure Storage Account that holds user session tokens (OAuth refresh tokens for Fabric Data Agent). Organizational policy mandates that storage accounts must have `publicNetworkAccess = Disabled`, but the current deployment **requires** public access because the Easy Auth sidecar accesses blob storage from the ACA platform plane (outside the customer VNet).

Additionally, all backend-to-service communication should be internal/private where possible, following defense-in-depth and zero-trust principles.

---

## 2. Current Architecture

### 2.1 Deployment Model

```
┌─────────────────────────────────────────────────────────────┐
│  Azure Container App Environment (Microsoft-managed VNet)   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Container App: maf-multi-agent                       │  │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────┐  │  │
│  │  │  supervisord │──│ Next.js    │──│ FastAPI      │  │  │
│  │  │              │  │ :3000      │  │ :8000        │  │  │
│  │  └─────────────┘  └────────────┘  └──────────────┘  │  │
│  │                         ▲                            │  │
│  │                         │ Ingress (public, :3000)    │  │
│  │                                                      │  │
│  │  ┌──────────────────────────────────────┐            │  │
│  │  │  Easy Auth Sidecar (ACA platform)    │            │  │
│  │  │  Entra ID login + token management   │            │  │
│  │  └──────────────────────────────────────┘            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Identity: maf-multi-agent-identity (User-Assigned MI)      │
│  Registry: ACR (Basic SKU, AcrPull via MI)                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Backend Outbound Connections (all over public internet)

| # | Target Service | Protocol | Source File | Auth Method |
|---|---------------|----------|-------------|-------------|
| 1 | **Azure AI Foundry / OpenAI** (Responses API) | HTTPS | `foundry_client.py`, `orchestrator.py` | DefaultAzureCredential (MI) |
| 2 | **Fabric Data Agent MCP** | HTTPS (JSON-RPC) | `fabric_mcp_client.py` | User token (Easy Auth) or DefaultAzureCredential |
| 3 | **Microsoft Graph API** | HTTPS | `graph_mail_client.py` | DefaultAzureCredential (MI) + Mail.Send |
| 4 | **Azure Resource Manager** | HTTPS | `fabric_capacity.py` | DefaultAzureCredential (MI) |
| 5 | **Application Insights** (OTLP) | HTTPS | `observability.py` | Connection string from Foundry project |
| 6 | **Entra ID** (login.microsoftonline.com) | HTTPS | Azure Identity SDK | Token acquisition |
| 7 | **Token Store** (Blob Storage) | HTTPS | Easy Auth sidecar (ACA platform) | MI + Storage Blob Data Contributor |
| 8 | **Azure Container Registry** | HTTPS | ACA platform (image pull) | MI + AcrPull |

### 2.3 Single-Container Design

Both frontend (Next.js) and backend (FastAPI) run **inside the same container** via supervisord:
- Frontend listens on `:3000` (ACA ingress target)
- Backend listens on `:8000` (localhost only, accessed via Next.js Route Handlers)
- The backend is **never** directly exposed to the internet

### 2.4 Current Terraform Infrastructure

```
Resource Group
├── Container App Environment (NO VNet — Microsoft-managed)
├── Container App (public ingress on :3000)
├── Container Registry (Basic SKU, public)
├── Log Analytics Workspace
├── User-Assigned Managed Identity
├── Entra App Registration (Easy Auth)
├── Security Groups (App-Users, Data-Users)
└── Storage Account (Token Store — publicNetworkAccess=Enabled ⚠️)
```

### 2.5 Current Terraform Comment (the problem)

```hcl
# Token Store (blob storage for Easy Auth session tokens)
# public_network_access MUST be enabled: the Easy Auth sidecar runs as an
# ACA platform component outside the customer VNet.
```

---

## 3. Requirements

### 3.1 Must Have

| ID | Requirement |
|----|-------------|
| R1 | Token store storage account must have `publicNetworkAccess = Disabled` (org policy compliance) |
| R2 | Frontend (Next.js) must remain publicly accessible via HTTPS |
| R3 | Backend outbound calls should traverse VNet (enabling private endpoint connectivity) |
| R4 | Easy Auth must continue to work (Entra ID login + Fabric user token acquisition) |
| R5 | No regression in functionality: Foundry agents, Fabric MCP, Graph Mail, Fabric capacity check, observability, session history |
| R6 | CI/CD pipeline (GitHub Actions → ACR → ACA) must continue to work |

### 3.2 Should Have

| ID | Requirement |
|----|-------------|
| R7 | AI Services (Azure OpenAI / Foundry) private endpoint for model inference |
| R8 | ACR private endpoint for image pulls |
| R9 | Application Insights data ingestion via private link |
| R10 | NAT Gateway for deterministic outbound IP (useful for allowlisting with Fabric) |

### 3.3 Nice to Have

| ID | Requirement |
|----|-------------|
| R11 | AI Search private endpoint (if used as knowledge source) |
| R12 | Network Security Group (NSG) rules for defense-in-depth |
| R13 | Azure Firewall or NVA for egress traffic inspection |

---

## 4. Proposed Architecture

### 4.1 Approach: VNet-Integrated ACA with Public Ingress

Place the ACA Environment into a **customer-managed VNet** with **external ingress** (publicly accessible). All outbound traffic from the container flows through the VNet, enabling private endpoint connectivity.

```
                                 Internet
                                    │
                    ┌───────────────┼───────────────────────┐
                    │               ▼                       │
                    │    ┌──────────────────────┐           │
                    │    │  ACA Public Ingress   │           │
                    │    │  (external, HTTPS)    │           │
                    │    └──────────────────────┘           │
                    │               │                       │
                    │    ┌──────────▼──────────┐            │
                    │    │  ACA Environment     │            │
                    │    │  (Infrastructure     │            │
┌───────────────────│────│   Subnet)            │────────────│──────────────────┐
│ Customer VNet     │    │                      │            │                  │
│                   │    │  ┌────────────────┐  │            │                  │
│                   │    │  │ maf-multi-agent│  │            │                  │
│                   │    │  │ (FE+BE)        │  │            │                  │
│                   │    │  └────────┬───────┘  │            │                  │
│                   │    │           │          │            │                  │
│                   │    │  ┌────────┴───────┐  │            │                  │
│                   │    │  │  Easy Auth     │  │            │                  │
│                   │    │  │  Sidecar       │  │            │                  │
│                   │    │  └────────┬───────┘  │            │                  │
│                   │    └──────────┼──────────┘            │                  │
│                   │               │                       │                  │
│                   └───────────────┼───────────────────────┘                  │
│                                   │                                          │
│  ┌──── Private Endpoints ─────────┼──────────────────────────────────────┐   │
│  │                                │                                      │   │
│  │  ┌──────────────────┐  ┌──────┴────────────┐  ┌──────────────────┐   │   │
│  │  │  Token Store PE  │  │  AI Services PE   │  │  ACR PE          │   │   │
│  │  │  (blob)          │  │  (OpenAI/Foundry) │  │  (registry)      │   │   │
│  │  └────────┬─────────┘  └────────┬──────────┘  └────────┬─────────┘   │   │
│  └───────────┼─────────────────────┼──────────────────────┼─────────────┘   │
│              │                     │                      │                  │
│  ┌───────────▼─────────┐ ┌────────▼──────────┐ ┌─────────▼────────┐        │
│  │ Private DNS Zone    │ │ Private DNS Zone  │ │ Private DNS Zone │        │
│  │ blob.core.windows   │ │ openai.azure.com  │ │ azurecr.io       │        │
│  │ .net                │ │ cognitiveservices │ │                  │        │
│  └─────────────────────┘ │ .azure.com        │ └──────────────────┘        │
│                          └───────────────────┘                              │
│                                                                             │
│  ┌─────────────────────────────────────────────┐                            │
│  │  NAT Gateway (optional)                     │                            │
│  │  Deterministic outbound IP for Fabric etc.  │                            │
│  └─────────────────────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────────┘

              Remaining Public Egress (via NAT GW or VNet default):
              ─ Microsoft Graph API (graph.microsoft.com)
              ─ ARM API (management.azure.com)
              ─ Fabric MCP (api.fabric.microsoft.com)
              ─ Entra ID (login.microsoftonline.com)
              ─ Application Insights (optional: can use AMPLS)
```

### 4.2 Why Single-Container Design Still Works

The user's goal — "frontend publicly accessible, backend communicates inside VNet" — is **already satisfied** by the current single-container design:

1. **Frontend** is publicly accessible via ACA ingress on `:3000`
2. **Backend** (`:8000`) is only reachable from `localhost` inside the container — it has **never** been exposed to the internet
3. With VNet integration, **all outbound traffic** (including backend calls to Azure services) flows through the VNet

No container split is needed. The current architecture already achieves the desired isolation. VNet integration simply enables private endpoint connectivity for outbound calls.

### 4.3 VNet Subnet Design

| Subnet | CIDR (example) | Purpose | Delegation |
|--------|---------------|---------|------------|
| `snet-aca-infra` | `/23` (minimum) | ACA Environment infrastructure | `Microsoft.App/environments` |
| `snet-private-endpoints` | `/24` | Private endpoints for Azure services | None |

> **Note:** ACA requires a minimum `/23` subnet (512 addresses) for the infrastructure subnet when using a workload profile environment.

---

## 5. Implementation Plan

### Phase 1: VNet Foundation + Token Store Private Endpoint

**Goal:** Satisfy the primary requirement (R1) — token store with disabled public access.

1. **Create VNet + Subnets** in Terraform
   - VNet with address space (e.g., `10.0.0.0/16`)
   - ACA infrastructure subnet (`/23`)
   - Private endpoints subnet (`/24`)

2. **Migrate ACA Environment** to the customer VNet
   - Add `vnet_integration` block to `azurerm_container_app_environment`
   - Configure `internal_load_balancer_enabled = false` (keep public ingress)

3. **Create Token Store Private Endpoint**
   - Private endpoint for the storage account (blob sub-resource)
   - Private DNS zone: `privatelink.blob.core.windows.net`
   - Link DNS zone to VNet
   - Set `publicNetworkAccess = Disabled` on storage account

4. **Validate Easy Auth token store access** via private endpoint

### Phase 2: AI Services Private Endpoint

5. **Create AI Services Private Endpoint**
   - Private endpoint for the Azure AI Services / OpenAI resource
   - Private DNS zone: `privatelink.openai.azure.com` and/or `privatelink.cognitiveservices.azure.com`
   - Disable public network access on the AI Services resource (if desired)

### Phase 3: ACR Private Endpoint

6. **Upgrade ACR** to Premium SKU (required for private endpoints)
   - Create private endpoint for ACR
   - Private DNS zone: `privatelink.azurecr.io`
   - Note: GitHub Actions CI/CD will need to reach ACR — consider keeping public access for CI or using a self-hosted runner

### Phase 4: Optional Enhancements

7. **NAT Gateway** — deterministic outbound IP
8. **Azure Monitor Private Link Scope (AMPLS)** — for App Insights
9. **NSG rules** — restrict subnet traffic
10. **AI Search Private Endpoint** — if applicable

---

## 6. Authentication Architecture Options

The authentication system is the **most impactful decision** in this VNet migration. Below is a thorough comparison of all viable options.

### Current State

```
User → ACA Ingress → Easy Auth Sidecar → Entra ID Login
                                        ↓
                        Stores tokens in Blob Storage (token store)
                                        ↓
                        Injects X-MS-TOKEN-AAD-ACCESS-TOKEN header
                                        ↓
                    Next.js → forwards header → FastAPI → Fabric MCP
```

- Easy Auth acquires a **delegated access token** for `https://api.fabric.microsoft.com/.default` (Fabric DataAgent.Execute.All scope) during the authorization code flow
- The token store (blob) persists access + refresh tokens across requests and container restarts
- Frontend calls `/.auth/refresh` before each run to renew the access token
- No MSAL library is used in the frontend — the codebase has zero `@azure/msal-*` dependencies
- Access control: `appRoleAssignmentRequired = true` + App-Users security group

---

### Option A: Keep Easy Auth + VNet Private Endpoint for Token Store ✅ RECOMMENDED

**Summary:** Keep the existing Easy Auth architecture. Place ACA in a VNet. Use a private endpoint for the blob token store.

**Research finding:** When ACA is deployed into a customer-managed VNet, the Easy Auth sidecar's egress **flows through the VNet**. Private endpoints for blob storage **do work** when DNS is correctly configured. This downgrades the original critical concern.

```
ACA (in VNet) → Easy Auth Sidecar → Private Endpoint → Blob Storage (public access disabled ✅)
```

| Aspect | Detail |
|--------|--------|
| **Code changes** | None |
| **Infra changes** | VNet + PE + Private DNS zone for blob |
| **Risk** | Low — must validate DNS resolution from sidecar |
| **Token lifecycle** | Handled by Easy Auth (refresh, persist, renew) |
| **Access control** | Unchanged (appRoleAssignmentRequired + security groups) |
| **Fabric token** | Unchanged (header injection → forwarded to backend) |

**Pros:**
- Zero application code changes
- Battle-tested auth flow already working in production
- Token refresh, persistence, and lifecycle fully managed by the platform
- Same Entra app registration, same security groups, same user experience

**Cons:**
- Still depends on blob storage (but now behind private endpoint — org policy compliant)
- The Terraform comment `publicNetworkAccess MUST be enabled` needs to be corrected (it was written before VNet integration was planned)
- Must validate empirically that the sidecar resolves blob DNS to the private endpoint

**Validation step:** After deploying ACA in VNet with private endpoint, run `nslookup <storageaccount>.blob.core.windows.net` from inside the container to confirm it resolves to the private IP (10.x.x.x), not the public IP.

---

### Option B: Replace Easy Auth with MSAL.js (Full Client-Side Auth)

**Summary:** Remove Easy Auth entirely. Add `@azure/msal-react` to the Next.js frontend. The SPA handles login, token acquisition, and refresh in the browser. No blob storage needed at all.

```
User → Next.js SPA → MSAL.js → Entra ID Login (Auth Code + PKCE)
                              ↓
                    Token stored in browser memory (MSAL cache)
                              ↓
                    Frontend sends token in Authorization header
                              ↓
                    Next.js Route Handler → FastAPI → Fabric MCP
```

| Aspect | Detail |
|--------|--------|
| **Code changes** | Significant — frontend auth layer + backend token validation |
| **Infra changes** | Remove storage account, remove Easy Auth config |
| **Risk** | Medium — new auth flow, needs thorough testing |
| **Token lifecycle** | MSAL.js handles silent renewal via refresh tokens |
| **Access control** | Same (appRoleAssignmentRequired + security groups) |
| **Fabric token** | Frontend acquires token for `api.fabric.microsoft.com` scope, sends in body/header |

**Pros:**
- **Eliminates blob storage entirely** — no token store, no private endpoint needed for auth
- Full control over auth UX (custom login page, error handling, loading states)
- Modern SPA auth pattern (PKCE, no client secret in browser)
- Token refresh happens client-side via MSAL's built-in silent renewal
- Simplifies infrastructure (fewer resources to manage)

**Cons:**
- **Significant frontend code changes**: Add `@azure/msal-react`, `MsalProvider`, `AuthenticatedTemplate`, token acquisition hooks
- **Backend validation needed**: FastAPI must validate JWT tokens (currently trusts Easy Auth headers)
- **No server-side redirect gating**: Unauthenticated users see the app shell before MSAL redirects (UX difference, not a security issue)
- **App registration changes**: Must configure as SPA platform (redirect URIs, enable PKCE), remove web platform + client secret
- **Logout flow**: Must implement custom logout instead of `/.auth/logout`
- **Token in browser memory**: Tokens live in browser sessionStorage — less secure than server-side token store (but standard for SPAs)

**Frontend changes required:**
1. `npm install @azure/msal-browser @azure/msal-react`
2. Create `lib/msal-config.ts` with app registration config
3. Wrap app in `MsalProvider` in `layout.tsx`
4. Replace Easy Auth user detection (`/api/auth` → MSAL `useAccount()`)
5. Replace `/.auth/refresh` call → `acquireTokenSilent()` before each run
6. Send token in request body or `Authorization: Bearer` header
7. Replace `/.auth/logout` → MSAL `instance.logoutRedirect()`
8. Replace `/.auth/login/aad` redirect → MSAL `instance.loginRedirect()`

**Backend changes required:**
1. Add JWT validation middleware (verify signature, audience, issuer)
2. Extract user email from validated JWT claims (instead of trusting `X-MS-CLIENT-PRINCIPAL-NAME`)
3. Read token from `Authorization` header (instead of `X-MS-TOKEN-AAD-ACCESS-TOKEN`)

---

### Option C: Easy Auth for Login Gate + MSAL.js for Tokens (Hybrid)

**Summary:** Keep Easy Auth as a gateway (login/logout, access control) but disable the blob token store. Add MSAL.js to the frontend for on-demand token acquisition for Fabric.

```
User → Easy Auth Sidecar → Login/Gate only (no token store)
                          ↓
     Frontend (MSAL.js) → acquireTokenSilent for Fabric scope
                          ↓
     Send token to backend → Fabric MCP
```

| Aspect | Detail |
|--------|--------|
| **Code changes** | Moderate — frontend token acquisition + dual auth |
| **Infra changes** | Remove storage account, keep Easy Auth (no token store) |
| **Risk** | Medium — two auth systems, potential confusion |
| **Token lifecycle** | Easy Auth = login gate; MSAL.js = Fabric token refresh |
| **Access control** | Easy Auth gates access; MSAL.js provides tokens |

**Pros:**
- No blob storage needed
- Easy Auth still handles the redirect/gate (users see login page before the app)
- MSAL.js provides fresh Fabric tokens on-demand

**Cons:**
- **Two auth systems** — confusing to maintain, debug, and reason about
- Easy Auth without token store means `X-MS-TOKEN-AAD-ACCESS-TOKEN` is **not available** — the header injection only works with token store enabled
- Users may see double login prompts (Easy Auth redirect + MSAL.js silent auth)
- More complex than either pure Option A or pure Option B

**Not recommended** due to dual-system complexity.

---

### Option D: Easy Auth + Filesystem Token Store (Ephemeral)

**Summary:** Keep Easy Auth but switch token store from blob to the local filesystem (ephemeral, in-container).

| Aspect | Detail |
|--------|--------|
| **Code changes** | None |
| **Infra changes** | Remove storage account, change Easy Auth config |
| **Risk** | High — tokens lost on every restart |
| **Token lifecycle** | Managed by Easy Auth but ephemeral |

**Pros:**
- No blob storage needed
- Zero code changes

**Cons:**
- **Tokens lost on every container restart, deployment, or scale event**
- All users must re-authenticate after every deployment
- With `min_replicas = 1`, there's only one instance, but any restart = full session loss
- ACA documentation states filesystem token stores are ephemeral and not recommended for production
- `offline_access` refresh tokens are lost — users can't resume long sessions

**Not recommended** for production use.

---

### Option E: Backend OBO (On-Behalf-Of) Flow

**Summary:** Frontend authenticates with MSAL.js and gets a token for the *backend API*. Backend exchanges it for a Fabric token via the OBO flow.

```
Frontend (MSAL.js) → acquires token for backend API scope
                    ↓
Backend → OBO flow → exchanges user token for Fabric token
                    ↓
Backend → calls Fabric MCP with OBO token
```

| Aspect | Detail |
|--------|--------|
| **Code changes** | Major — frontend MSAL + backend OBO flow implementation |
| **Infra changes** | Remove Easy Auth + storage; need client secret/certificate for OBO |
| **Risk** | High — most complex option |

**Pros:**
- Backend has full control over downstream token acquisition
- Fabric token never touches the browser
- Proper enterprise pattern for API→downstream service calls

**Cons:**
- **Most complex**: Requires two app registrations (SPA + API), OBO flow implementation in Python (MSAL Python), token cache management on backend
- Backend needs a client secret or certificate for the confidential client OBO exchange
- MSAL Python OBO token cache needs its own persistence (Redis, in-memory, etc.)
- Over-engineered for this use case — the frontend can directly acquire Fabric tokens

**Not recommended** — unnecessary complexity when the frontend can request Fabric tokens directly.

---

### Recommendation Matrix

| Option | Code Changes | Storage Needed | Complexity | Production Ready | Recommended |
|--------|-------------|----------------|------------|-----------------|-------------|
| **A: Easy Auth + VNet PE** | None | Yes (PE) | Low | ✅ Yes | ✅ **Yes** |
| **B: Full MSAL.js** | Significant | No | Medium | ✅ Yes | ✅ Yes (alternative) |
| C: Hybrid | Moderate | No | High | ⚠️ Risky | ❌ No |
| D: Filesystem store | None | No | Low | ❌ No | ❌ No |
| E: Backend OBO | Major | No | Very High | ✅ Yes | ❌ No (over-engineered) |

### Recommended Approach

**Primary: Option A** — Keep Easy Auth, add VNet + private endpoint for token store. This is the lowest-risk path with zero code changes. Research confirms the Easy Auth sidecar in a VNet-integrated ACA environment routes egress through the VNet and can reach private endpoints.

**Fallback: Option B** — If Option A fails in validation (sidecar can't reach the PE), or if the org policy is stricter than "no public access" (e.g., "no storage account for auth at all"), switch to full MSAL.js. This eliminates the storage dependency entirely but requires significant frontend/backend work.

---

## 7. Concerns & Discussion Points

### 🟢 Resolved: Easy Auth Sidecar + VNet Token Store

**Previously rated 🔴 Critical — now downgraded to low risk.**

Research confirms that when ACA is deployed into a customer-managed VNet, the Easy Auth sidecar's egress routes through the VNet. Private endpoints for blob storage **are accessible** from the sidecar when private DNS zones are correctly configured.

The current Terraform comment (`publicNetworkAccess MUST be enabled`) was written for the non-VNet deployment and should be updated after migration.

**Remaining validation:** After deploying, confirm DNS resolution from inside the container returns the private IP for `<storageaccount>.blob.core.windows.net`.

---

### 🟡 Concern: ACA Environment Migration = Recreate

Azure Container Apps Environments **cannot be migrated** into a VNet after creation. The VNet configuration is immutable after provisioning.

**Impact:**
- The existing ACA Environment must be **destroyed and recreated** with VNet configuration
- This means a brief downtime window
- The Container App itself will be recreated
- Easy Auth configuration will need to be re-applied
- The app registration redirect URI will change (new FQDN)

**Mitigation:**
- Plan a maintenance window
- Use Terraform `moved` blocks or import to minimize state disruption
- Pre-create the new environment and do a blue-green cutover if zero-downtime is required
- Update the Entra app registration redirect URI after cutover

---

### 🟡 Concern: ACR Premium SKU Cost

Private endpoints for ACR require **Premium SKU** (currently Basic).

- Basic: ~$5/mo
- Premium: ~$50/mo

If ACR private endpoint is not a hard requirement, keep Basic SKU and let image pulls go over public network (they're already authenticated via MI + AcrPull RBAC).

---

### 🟡 Concern: CI/CD Pipeline Access to ACR

If ACR is behind a private endpoint with public access disabled:
- GitHub Actions runners won't be able to `az acr build` (cloud build runs inside ACR, but the CLI command needs to reach ACR's management plane)
- **Options:**
  - Keep ACR public access enabled for management plane (only data plane behind PE)
  - Use GitHub-hosted runners with Azure VNet connectivity (preview feature)
  - Use self-hosted runners inside the VNet
  - Add GitHub Actions runner IPs to ACR firewall rules

**Recommendation:** Keep ACR with public access for now. The image pull from ACA benefits from the private endpoint, but the CI push can stay public.

---

### 🟡 Concern: Fabric MCP + Graph API Remain Public

Fabric Data Agent MCP (`api.fabric.microsoft.com`) and Microsoft Graph (`graph.microsoft.com`) are **public-only** services — they don't support private endpoints. These outbound calls will continue to traverse the public internet.

This is acceptable because:
- Traffic is TLS-encrypted
- Authentication is via bearer tokens (user token for Fabric, MI token for Graph)
- The VNet + NAT Gateway provides egress control

---

### 🟢 Observation: Backend Is Already Not Exposed

A key positive finding: the backend (FastAPI on `:8000`) is **already not publicly accessible**. ACA ingress targets port 3000 (Next.js), and Next.js Route Handlers proxy API calls to `localhost:8000`. No internet traffic can reach the backend directly.

The VNet integration adds defense for **outbound** traffic, not inbound — which is the correct framing of the problem (protecting the storage account and AI service endpoints).

---

### 🟢 Observation: No Container Split Needed

Some VNet migration designs split frontend and backend into separate containers for network isolation. This is **not necessary** here because:

1. Backend is already localhost-only (no external exposure)
2. The VNet-integrated ACA environment with external ingress already gives us: public-in + private-out
3. Splitting would introduce complexity: inter-service networking, dual deployments, separate scaling
4. The single-container + supervisord design is appropriate for this workload's scale

---

### 🟡 Concern: Private DNS Zones

Each private endpoint requires a corresponding Azure Private DNS Zone linked to the VNet. DNS resolution must be correct for:
- `*.blob.core.windows.net` → private IP
- `*.openai.azure.com` → private IP
- `*.azurecr.io` → private IP (if ACR PE is used)

If any DNS zone is misconfigured, connections will resolve to the public IP and fail (because public access is disabled on the resource).

**Mitigation:** Terraform creates and manages all DNS zones + VNet links together with the private endpoints.

---

### 🟡 Concern: Azure AI Foundry Project Endpoint

The `PROJECT_ENDPOINT` used by `foundry_client.py` and `observability.py` is typically a public URL like:
```
https://<name>.services.ai.azure.com/api/projects/<project>
```

For private endpoint connectivity, the underlying AI Services resource needs a private endpoint. The SDK should automatically resolve to the private IP when Private DNS is configured.

**Validate:** That the `azure.ai.projects.aio.AIProjectClient` and `AzureOpenAIResponsesClient` work correctly when the AI Services resource is behind a private endpoint.

---

### 🟡 Concern: Subnet Sizing

ACA requires a dedicated subnet with delegation `Microsoft.App/environments`. The minimum CIDR is:
- **Consumption-only:** `/23` (512 addresses)
- **Workload profiles:** `/23` (512 addresses)

The VNet address space should be planned to allow future growth (additional subnets for other services, peering, etc.).

---

### 🟢 Observation: No Code Changes Expected

The VNet integration is purely an **infrastructure change**. No application code changes should be needed because:
- All Azure SDK clients use DNS-based resolution (private DNS zones handle the routing)
- Authentication (MI, user tokens) is unchanged
- The supervisord + localhost proxy pattern is unaffected
- SSE streaming and keepalive patterns are unaffected

---

## 7. Terraform Changes Summary

| Current Resource | Change |
|-----------------|--------|
| `azurerm_container_app_environment` | Add `vnet_integration` block with subnet ID |
| `azapi_resource.tokenstore_account` | Change `publicNetworkAccess` to `Disabled` |
| **New resources** | |
| `azurerm_virtual_network` | Customer-managed VNet |
| `azurerm_subnet` (×2) | ACA infra subnet + PE subnet |
| `azurerm_private_endpoint` (token store) | Blob PE for storage account |
| `azurerm_private_dns_zone` (blob) | `privatelink.blob.core.windows.net` |
| `azurerm_private_dns_zone_virtual_network_link` | Link DNS zone to VNet |
| `azurerm_private_endpoint` (AI Services) | Phase 2 |
| `azurerm_private_dns_zone` (OpenAI) | Phase 2 |
| `azurerm_private_endpoint` (ACR) | Phase 3 (optional, requires Premium SKU) |
| `azurerm_nat_gateway` | Phase 4 (optional) |

---

## 8. Migration Strategy

### Recommended: Terraform Recreate with Downtime Window

1. **Pre-work:**
   - Document current Entra app registration redirect URI
   - Note current Container App image tag
   - Back up `terraform.tfstate`

2. **Execute:**
   - Apply Terraform changes (will destroy + recreate ACA Environment)
   - ACA Environment + Container App are recreated in the VNet
   - Update Entra app registration redirect URI (new FQDN if domain changed)
   - Re-deploy the application image
   - Validate Easy Auth, token store access, all agent calls

3. **Rollback:**
   - If VNet integration fails, revert Terraform to previous state
   - Apply — ACA Environment recreated without VNet

**Expected downtime:** 15-30 minutes (ACA Environment provisioning + app deployment)

### Alternative: Blue-Green (Zero-Downtime)

Create a new ACA Environment with VNet alongside the existing one, test thoroughly, then switch DNS/traffic. More complex but avoids downtime.

---

## 9. Testing Checklist

- [ ] ACA Environment deploys in VNet with external ingress
- [ ] Frontend is accessible from public internet (HTTPS)
- [ ] Easy Auth login flow works (Entra ID redirect → callback → token store)
- [ ] Token store uses private endpoint (verify with `nslookup` from container)
- [ ] Token store storage account has `publicNetworkAccess = Disabled`
- [ ] Foundry agents work (CoderData, Operations, WebSearch)
- [ ] Fabric Data Agent MCP works (with user token)
- [ ] Graph Mail works (send email notification)
- [ ] Fabric capacity status check works
- [ ] Application Insights traces appear
- [ ] Session history (file I/O to local disk) works
- [ ] CI/CD pipeline deploys successfully
- [ ] Image pull from ACR succeeds
- [ ] SSE streaming + keepalive works end-to-end

---

## 11. Open Questions for Discussion

1. **Auth strategy decision:** Do we go with Option A (Easy Auth + VNet PE, zero code changes) or Option B (MSAL.js, eliminates storage entirely)? Option A is lower risk; Option B is cleaner long-term.

2. **Token store validation:** Before committing to Option A, should we do a quick spike — deploy a minimal VNet-integrated ACA with Easy Auth + private endpoint blob store — to validate the sidecar can reach it?

3. **AI Services private endpoint:** Is the AI Services resource shared with other applications? Disabling public access would affect all consumers.

4. **ACR private endpoint:** Is the cost increase to Premium SKU ($5 → $50/mo) justified, or is authenticated public pull acceptable?

5. **Outbound egress control:** Do we need a NAT Gateway for a deterministic outbound IP? Some Fabric configurations benefit from IP allowlisting.

6. **Environment recreation:** Is a maintenance window acceptable, or do we need the blue-green approach?

7. **VNet address space:** Is there an existing corporate VNet we should peer with, or do we create a standalone VNet?

8. **AI Search:** Is Azure AI Search currently behind a private endpoint, or does it also need to be addressed in this work?

9. **Future scalability:** If we ever need to split frontend/backend into separate containers (scale independently), should we plan the VNet topology for that now?

---

## Appendix A: External Service Connectivity Matrix (Post-VNet)

| Service | Connectivity | Private Endpoint | DNS Zone |
|---------|-------------|-----------------|----------|
| Token Store (Blob) | **Private** | ✅ Required (R1) | `privatelink.blob.core.windows.net` |
| AI Services / OpenAI | **Private** (Phase 2) | ✅ Recommended | `privatelink.openai.azure.com` |
| ACR | **Private** (Phase 3) | Optional | `privatelink.azurecr.io` |
| App Insights | **Private** (Phase 4) | Optional (AMPLS) | `privatelink.monitor.azure.com` |
| Microsoft Graph | Public | ❌ Not available | N/A |
| Fabric MCP | Public | ❌ Not available | N/A |
| ARM API | Public | ❌ Not available | N/A |
| Entra ID | Public | ❌ Not available | N/A |

## Appendix B: Files Modified by This Change

| File | Change Type |
|------|------------|
| `deploy/terraform/main.tf` | Major: VNet, subnets, PEs, DNS zones, ACA env VNet config |
| `deploy/terraform/variables.tf` | Add VNet CIDR, subnet CIDRs, PE toggle variables |
| `deploy/terraform/outputs.tf` | Add VNet ID, subnet IDs, PE IPs |
| `deploy/post_infra_deploy.sh` | Update token store validation (check PE instead of public access) |
| `deploy/deploy.sh` | No changes expected |
| `.github/workflows/deploy.yml` | No changes expected (unless ACR goes private) |
| `backend/src/*` | **No changes expected** (infrastructure-only change) |
| `frontend/**` | **No changes expected** |
