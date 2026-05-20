# PRD — Counter-proposal: Stay on MAF, fix what hurts

> **Status:** Draft v0.1 — companion to `PRD-copilot-sdk-rewrite.md`.
> **Position:** This is the **"don't rewrite" option.** It argues that the *product* problems the team experiences with the current stack are largely caused by ~5 specific issues in MAF-adjacent code, and that those issues can be fixed in **2–3 weeks of focused work** *without* swapping out the agent runtime.
> **Date:** 2026‑05‑20
> **Source repo:** `~/Documents/PRJ/_TESTS/maf-multi-agent/`
> **Companion PRD:** `PRD-copilot-sdk-rewrite.md` (proposes a full rewrite onto the Copilot CLI SDK).

---

## 0. TL;DR

Six pains were enumerated in the rewrite PRD (its §1.1). **Three of them are real and worth fixing**; **two are cosmetic and can stay**; **one is a duplicate framing of an actual product decision**. Fixing the three real ones requires ~1 KLoC of edits and the *same* runtime (MAF + Foundry + Fabric MCP + Easy Auth). No new identity model, no new licensing question, no preview SDK, no per-user GitHub quota, no subprocess lifecycle to manage, no permission UX to bolt onto the frontend.

This document proposes **five surgical workstreams**, each runnable in 2–5 days, that together deliver the operational benefits the rewrite was promising — without the strategic risk.

If after reading both PRDs the team's answer to "do we want to be on GitHub's stack long-term?" is **yes**, the rewrite PRD wins. If the answer is **no**, **not yet**, or **only the data plane is the problem**, this counter-proposal wins.

---

## 1. The premise we are challenging

The rewrite PRD argues that ~3.5 KLoC of Python should be replaced by declarative markdown + configuration on top of Copilot CLI. The structural critique is fair. But notice what is *not* in that 3.5 KLoC:

* `api.py` (~1 200 lines) — the HTTP/SSE surface. **Not touched** by the rewrite.
* `history_store.py` (~430 lines) — Blob persistence. **Not touched** by the rewrite.
* `post_run_actions.py`, `summary.py`, `graph_mail_client.py`, `observability.py`, `run_store.py`, `file_store.py` — all kept as-is.
* The entire frontend.

So the rewrite is replacing **the agent runtime** — the part of the system that has been *most stable* over the last six months — while leaving every line of code that the team actually changes during feature work. That is the inverted blast radius: the rewrite touches things that haven't broken, and leaves things that have.

Meanwhile, the *actual* day-to-day pains the team complains about are:

| Real pain | Root cause | Fix cost |
|---|---|---|
| Reasoning capture breaks on MAF upgrade | Private monkey-patch on `_inner_get_response` | 1–2 days |
| Fabric MCP code is huge and "weird" | The HTTP/JSON-RPC client was written before MAF had MCP support | 3–5 days |
| `agents/*.yaml` schema branches on `type: foundry \| mcp` | Schema added one branch at a time, never refactored | 1–2 days |
| MAF dependency is a pinned git SHA | MAF hasn't shipped a stable PyPI release; pin advances by hand | 0 days, until MAF ships |
| Two parallel identity stacks (Easy Auth + MI) | Genuine product requirement (Fabric needs user identity) | not fixable without dropping Fabric |
| Reinventing things Copilot CLI ships natively | True, but only matters if we *want* to be on Copilot CLI | n/a |

The first four are concrete and addressable. The fifth is a product decision. The sixth is the rewrite's *raison d'être*, not a pain.

---

## 2. Goals and non-goals of this counter-proposal

### 2.1 Goals

1. **Eliminate the MAF private-API monkey-patch.** Use an official hook or commit one upstream.
2. **Cut the Fabric MCP client to <100 lines** using MAF's now-built-in MCP support, *or* replace it with a small in-repo wrapper that does only the bits MAF can't do.
3. **Unify the agent schema.** Single declarative YAML/TOML, one parser, one set of tests.
4. **Lock the MAF dependency** to a vetted commit-or-PyPI version, with an upgrade SOP.
5. **Document the runtime contracts** so the next engineer doesn't have to read three files to learn how dispatch works.

### 2.2 Non-goals

* **Not** moving to Copilot CLI SDK. Explicitly.
* **Not** changing the frontend, the SSE protocol, the history store, the post-run actions, or the email flow.
* **Not** dropping any specialist agent (the Data Analyst stays — that's the *point* of staying on MAF: Fabric integration works).
* **Not** changing identity, hosting (ACA), or deployment topology.

### 2.3 What this option explicitly accepts

* The product **stays Azure-shaped** — no GitHub identity in the middle of the chain.
* The Foundry-Prompt-Agent pattern stays — domain-tuned agents, Responses API, Code Interpreter file extraction.
* The current per-specialist model choice (`gpt-5.2` for coder, `gpt-4.1-mini` for KB, `gpt-4o` for web search) stays.
* The "MAF preview" tax stays — we keep pinning a commit and reviewing breaking-change risk on each bump.
* The reasoning-capture hook stays *fragile* unless we successfully land a public hook upstream (see W1 below).

---

## 3. The five workstreams

Each workstream is independently shippable. Ordered by impact-per-day.

### W1 — Replace the reasoning monkey-patch (1–2 days) — DONE

**Status.** Done. Reasoning capture now uses supported MAF middleware/hooks instead of overriding private SDK internals, and regression tests cover reasoning/tool-decision ordering.

**Today.** `backend/src/orchestrator.py:39–67` overrides `AzureOpenAIResponsesClient._inner_get_response`. A loud banner warns the next reader. The method is **private**; any MAF refresh can rename it.

**Three options, in order of preference:**

1. **Use a public MAF hook.** Verify whether the current MAF main (post the pinned SHA) exposes a `client.on_response(...)` or middleware mechanism. If yes, port to it. If yes-but-buggy, file an upstream PR.
2. **Subclass `AzureOpenAIResponsesClient`** and override the public `get_response` / `get_streaming_response` methods that wrap `_inner_get_response`. Less fragile than monkey-patching a private method.
3. **Move reasoning capture to OpenTelemetry spans.** The OpenAI Python SDK emits span attributes for reasoning summaries; intercept at the OTel exporter, not at MAF. This decouples us from MAF entirely.

**Acceptance.** No `_` prefixed names in `orchestrator.py`. Unit test that simulates a Responses API call with reasoning content and asserts the event fires.

**Risk.** Option 1 depends on MAF having shipped the hook by now. Option 2 still couples to `agent-framework-azure-ai` class names. Option 3 is purest but requires OTel instrumentation in the data path, which we already have for production via Azure Monitor.

### W2 — Shrink `fabric_mcp_client.py` (3–5 days) — DONE

**Status.** Done. `fabric_mcp_client.py` is now a thin MAF Streamable HTTP MCP wrapper under 200 lines, with user-token threading preserved and backend regression tests passing.

**Today.** ~750 lines of bespoke HTTP/JSON-RPC, including:
* token acquisition (DefaultAzureCredential vs. user token threading),
* SSE streaming parser,
* tool listing/calling,
* logging with bounded body previews,
* error mapping.

**Verify first:** does the pinned MAF main support **MCP servers as first-class tools**? (Microsoft has been adding MCP support to MAF; check `agent-framework-core` for an `McpTool` or equivalent.) If yes:

* Replace `fabric_mcp_client.py` with a thin **wrapper** that handles **only** the things MAF can't do natively — namely, **per-call bearer substitution with the Easy-Auth user token** (Fabric's hard requirement). This is ~80–150 lines.
* Delete the rest.

If MAF doesn't have MCP yet, do the same wrapper-shrink but call our own minimal JSON-RPC client from inside it. The mental model becomes: "MAF orchestrator calls a tool; the tool calls Fabric; Fabric requires user-bearer."

**Acceptance.** `fabric_mcp_client.py` is under 200 lines. The user-token threading path is unchanged (still tested against the maintenance fixture). All existing pytest cases pass.

**Risk.** The user-token requirement is the entire reason this file is large. Cutting it to 200 lines might be optimistic; even 400 would be a 47% reduction and a much easier code review surface.

### W3 — Unify the agent schema (1–2 days)

**Today.** `agents/*.yaml` carries two distinct shapes (`type: foundry` vs. `type: mcp`) with overlapping but not identical keys. `agent_loader.py` branches on `type` in three places. The McpAuthConfig nested object is required only on MCP entries. Adding a third type would require touching all of these.

**Proposal.**

```yaml
# agents/data_analyst.yaml (after unification)
name: data_analyst_tool
display_name: Data Analyst
avatar: 📊
role: Data Analyst

description: …
task_description: …
dispatch_instructions: …

backend:
  type: mcp                       # one of: foundry, mcp, (future) http, local
  endpoint:                       # backend-type-specific block
    mcp_url_env: FABRIC_DATA_AGENT_MCP_URL
    tool_name: fabric-data-agent
    auth:
      type: default_credential    # default_credential | service_principal | user_token_passthrough
      scope: https://api.fabric.microsoft.com/.default
```

Foundry shape collapses to:

```yaml
backend:
  type: foundry
  endpoint:
    agent_name: CoderData
```

**Loader change.** Turn `parse_agent_yaml` into a dispatch table keyed on `backend.type`. Each handler validates its own block. Add a JSON-schema test that asserts every YAML in `agents/` is valid against the schema. Adding a new backend type means **one** new handler — not three edit sites.

**Acceptance.** `agent_loader.py` is under 200 lines (currently 310). Pytest schema-validation test exists. Documentation in `AGENTS.md` updated.

**Risk.** This is a re-shaping of working code. Risk of regression is real; mitigated by running the existing pytest suite + the maintenance fixture both before and after.

### W4 — Lock MAF dependency + write the upgrade SOP (1 day) — DONE

**Status.** Done. MAF packages are pinned consistently and the upgrade process is documented as a bounded SOP.

**Today.** `pyproject.toml`:

```
"agent-framework-core @ git+https://github.com/microsoft/agent-framework.git@91675bde…",
"agent-framework-azure-ai @ git+https://github.com/microsoft/agent-framework.git@91675bde…",
```

**Proposal.**

1. **If MAF has shipped to PyPI** by the time we ship this counter-proposal: pin to a stable PyPI version with a `~=` semver constraint. Add Dependabot/Renovate to the repo.
2. **If MAF is still pre-release**:
   * keep the git-SHA pin (it is correct — git SHAs are immutable),
   * add a `MAF_UPGRADE.md` runbook describing exactly how to bump (check release notes, re-run W1's test, re-run the maintenance fixture, re-test the Code Interpreter file extraction),
   * add a quarterly calendar reminder to evaluate the upgrade.

**Acceptance.** The pin policy is documented. The upgrade is described as a 1-day chore, not an open-ended risk.

**Delivered artifacts.**

* `MAF_UPGRADE.md` — package pin policy, upgrade checklist, targeted tests, full validation, and manual end-to-end acceptance criteria.

**Risk.** None — this is pure documentation + tooling.

### W5 — Document the runtime contracts (2–3 days) — DONE

**Status.** Done. The runtime contracts are documented and covered by a pytest guard that fails when a backend `EventType` is not mentioned in the event contract.

**Today.** `AGENTS.md` describes *the architecture*. There is no document describing **the agent dispatch contract** — i.e., what a specialist's `task_description` is allowed to assume, what the orchestrator promises about task IDs, what events fire when a specialist writes to the SharedDocument, what happens on error.

A new contributor today reads `scratchpad/workflow.py` → `scratchpad/dispatcher.py` → `agent_loader.py` → `foundry_client.py` → `events.py` to understand "what happens when a tool is called." That is ~700 lines of code as documentation.

**Proposal.** Write three short pages:

1. **`docs/CONTRACT-orchestrator.md`** — what events the facilitator emits and when, what its tools can return, what failure modes the workflow expects.
2. **`docs/CONTRACT-specialist.md`** — the contract a `.yaml` agent definition is committing to: what its function signature is at dispatch time, what fields are guaranteed in the task context, what it must do with the SharedDocument.
3. **`docs/CONTRACT-events.md`** — every `EventType`, every field of `AgentEvent.data` for that type, every consumer (backend logger, SSE, frontend renderer). This becomes the source of truth for both backend and frontend.

**Delivered artifacts.**

* `docs/CONTRACT-orchestrator.md`
* `docs/CONTRACT-specialist.md`
* `docs/CONTRACT-events.md`
* `backend/tests/test_contract_docs.py` — validates that every backend `EventType` is documented.

**Acceptance.** Each document is reviewed by at least one engineer who didn't write the code. CI lints that every `EventType` enum value is mentioned in `CONTRACT-events.md`.

**Risk.** Almost none. Worst case the docs go stale; mitigated by linking them from the code paths they describe and running the CI link-check.

---

## 4. What this option **does not** fix

Being explicit, because the rewrite PRD addresses these and this counter-proposal does not:

* **The two parallel agent abstractions** (Foundry agent vs. MCP) — they survive. W3 makes adding new ones easier; it does not collapse them.
* **The MAF preview-grade dependency** — still a quarterly chore (W4).
* **Reinventing infinite sessions / plan mode / native MCP / native streaming reasoning** — Copilot CLI ships them; MAF does not. We continue to live without those *features*.
* **Skills as a content-extensibility surface** — the existing `.agents/skills/` directory keeps existing as private convention. There is no Copilot CLI to discover them.
* **Per-tool permission control** — there is none, just as today. (This is arguably a feature, not a bug, for an internal SaaS.)

---

## 5. Risk comparison vs. the rewrite

| Risk axis | Rewrite (`PRD-copilot-sdk-rewrite.md` v0.2) | Counter-proposal (this doc) |
|---|---|---|
| **Licensing / quota** | Mitigated by BYOM + offline; residual service-PAT question | None new — Azure-only |
| **Per-specialist model loss** | Accepted as v1 cost (D2) | None — tiered models stay |
| **Quality regression** | Mitigated by D3 (prompts ported, RAG as skill); side-by-side test still required | None — same prompts, same models, same runtime |
| **Preview-grade SDK** | New hard dependency (Copilot CLI SDK + binary) | None new — MAF was already preview |
| **Subprocess lifecycle on ACA** | New operational concern | None — no subprocess |
| **Permission UX collision** | New surface to design | None — no permission model |
| **GitHub identity in the chain** | New compliance surface | None — Azure only |
| **Code reduction** | ~50% Python backend LoC | ~10–15% backend LoC (W2 + W3) |
| **Strategic alignment with Microsoft/GitHub agent platforms** | Strong — Copilot CLI is the bet | Weak — we stay on a niche MAF stack |
| **Resource cost** | 4–7 weeks one engineer (v0.2) | **2–3 weeks** one engineer |
| **Reversibility** | Hard — full rewrite, frontend coupling | Trivial — each workstream is its own PR |

---

## 6. Decision matrix

> If you can answer "yes" to *any* of these, the rewrite is the right call. If you answer "no" to *all*, the counter-proposal is the right call.

* Do we want **Copilot CLI Skills** as the canonical extensibility surface for non-engineers? (You add a SKILL.md without touching Python.)
* Do we want **`/plan`, `/fleet`, infinite sessions, native reasoning streaming** as first-class user features?
* Are we going to **add many more MCP servers** in the next 12 months (e.g., GitHub MCP, Linear MCP, Jira MCP), and we'd rather configure them than write clients?
* Is **GitHub identity / Copilot quota** acceptable in our deployment story (per D1 it now is, via BYOM)?
* Do we expect the **MAF dependency cost** (pinned SHAs, breaking changes on bump) to get worse before it gets better?

If we answer "yes" to most of these, the rewrite is the right call.

If the honest answer is "we just want the existing app to be less fragile to maintain," **this counter-proposal does that in 2–3 weeks**.

---

## 7. Migration plan (if this proposal wins)

Five sequential PRs. Each is independently revertable.

| Week | PR | Workstream | Status | Risk |
|---|---|---|---|---|
| 1 | "Replace reasoning monkey-patch with public hook" | W1 | DONE | low |
| 1 | "Lock MAF dependency + add UPGRADE runbook" | W4 | DONE | none |
| 2 | "Shrink fabric_mcp_client to MCP wrapper" | W2 | DONE | medium |
| 2 | "Unify agent YAML schema under backend.type" | W3 | TODO | medium |
| 3 | "Add runtime contract docs + CI link check" | W5 | DONE | none |

**Total estimate:** 2–3 weeks one engineer, no UX changes, no deployment changes, no risk to in-flight runs.

---

## 8. What we lose by not rewriting

Honest assessment:

* **We do not get Copilot CLI features for free** — plan mode, fleet, skills auto-discovery, infinite sessions, native reasoning events.
* **Adding a new specialist still requires Python knowledge** — there is no `.agent.md` convention.
* **The strategic question is deferred, not answered** — we will likely revisit this in 12 months, possibly with a more mature SDK and a clearer GitHub multi-tenant story.
* **The team learns less about Copilot CLI as a platform** — which has its own cost if Copilot becomes the dominant agent runtime in 2027.

---

## 9. What we keep by not rewriting

Equally honest:

* **A working data analyst** — Fabric MCP stays, the Data Analyst stays in scope. The rewrite's D4 dropped it.
* **Per-specialist model tiers** — `gpt-4.1-mini` for KB, `gpt-4o` for web search, `gpt-5.2` for coder. The rewrite's D2 collapsed them.
* **A fully Azure-shaped stack** — no GitHub identity, no Copilot license question, no service-PAT in env.
* **The frontend, the SSE protocol, the history store, the post-run actions, the email flow** — all untouched. Lowest possible blast radius.
* **2 months of engineering time saved**, repurposable for actual product features.

---

## 10. Decision needed from the reviewer

1. Read **§6 Decision matrix.** How many "yes" do we have today, honestly?
2. If **≥2 yes:** the rewrite PRD (`PRD-copilot-sdk-rewrite.md`) wins; archive this counter-proposal.
3. If **0–1 yes:** approve this counter-proposal's five workstreams. Start with W1 + W4 in week 1.
4. Either way, **decide before starting Phase 0 of the rewrite**. Doing both at once burns the same engineer twice.

— end of document —
