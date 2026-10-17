# Claude Opus 5.5 — Aggressive Subagent Delegation Addendum

> **P0 execution directive for the Opus coordinator.** Read at session start, before touching coordination code. This is a parallel-execution policy, not a request to expand project scope.

## Lead instruction

**Use subagents aggressively and immediately when your environment supports them.** Do not complete independent research, implementation, unit-test design, and code review serially yourself. Delegate high-value, bounded work in parallel **as soon as the shared contract and ownership constraints are clear**. You remain responsible for integration, correctness, and PR quality.

If no subagent orchestration capability exists in the environment, do not claim to have launched agents. Execute the same bounded workstreams serially and report the limitation.

**Before launching subagents:**
1. Read root `AGENTS.md`, `CLAUDE.md`, `docs/daybridge/AGENT_PLAYBOOK.md`, `docs/handoffs/README.md`, and `docs/daybridge/PRODUCT_ENGINEERING_SPEC.md`.
2. Check whether PR #1 (documentation) is merged; use the documentation branch for reference otherwise. Work on a separate code feature branch from the latest approved baseline.
3. Publish **one small, additive typed coordination contract** and freeze the minimum shapes used by child agents. You personally own contract decisions and `src/lib/schema.ts`.
4. Assign **one writer per file**. Tell each child exactly which paths it may change, what it must not touch, acceptance tests, and the artifact to return.
5. Launch an initial wave of 3–5 independent agents where supported. Spawn a second, targeted wave only to unblock integration or review.

## Recommended parallel work allocation

| Priority | Subagent / workstream | Allowed writes | Dependency | Definition of done |
|---|---|---|---|---|
| P0 | **A. State-machine implementer** | `src/domain/coordination/state.ts` | Contract frozen | Correct blocked/proposed/approved/coordinating/READY/NEEDS_REPLAN transitions; no false READY |
| P0 | **B. Consent and action-policy implementer** | `src/domain/coordination/consent.ts` | Contract frozen | Explicit approval scoped by action, target, payload, time and expiry; reject stale/revoked consent |
| P0 | **C. Events/idempotency implementer** | `src/domain/coordination/events.ts` | Contract frozen | Duplicate and stale/out-of-order provider events handled deterministically; auditable event record |
| P0 | **D. API boundary implementer** | `src/app/api/coordination/**` only | Endpoint contract frozen | Zod validation, explicit error responses and mock-safe orchestration; no real network side effects |
| P0 | **E. Adversarial unit-test author** | `src/domain/coordination/invariants.test.ts` only | Contract frozen; compile when exports appear | Tests false READY, unauthorized action, cancellation recovery, duplicates, invalid state transition and pending confirmations |
| P0 | **F. Critical reviewer (read-only)** | No writes; findings back to parent | First integration available | Identify contract drift, privacy or consent flaws, race conditions and missing evidence without duplicating GPT Work's broad audit |

**Parent Opus owns:** `src/lib/schema.ts`, `docs/daybridge/COORDINATION_CONTRACT.md`, interface decisions, coordination integration/glue files, final verification, and the PR. If subagent tools cannot isolate writes reliably, use read-only delegated work and implement edits yourself.

Avoid delegation theater: spawning agents to restate the spec, invent product features, polish slides/UI, search unnecessary libraries or debate architecture is not useful. Don't create a second agent to edit a file currently being edited by another.

## Scheduling: maximize useful concurrency

**Wave 0 — first:** Read baseline, freeze minimal contract, publish precise file ownership.

**Wave 1 — launch together:** State machine, consent, event/idempotency, tests, API boundary (once request/response definitions are available). The test author may initially write red cases that fail until implementations land. Parent resolves any shared interface mismatch.

**Wave 2 — integrate immediately:** Parent checks exports/contracts and assembles the first end-to-end offline sequence. Send a read-only reviewer against the assembled path. Fix only P0 blockers, re-run tests, open PR.

When blocked, child agents should return a concise interface question and continue independent work. Do not let one unresolved provider detail hold up all streams. Favor mock-safe providers and injectable ports. **No waiting for external API credentials.**

## Team ownership — hard boundary

- **Teammate A:** all UI, `src/app/page.tsx`, `src/components/**`, styles and frontend wiring.
- **Teammate B:** real activity data, `src/domain/activities.ts`, **third-party/provider integrations** in `src/integrations/**`, API integration adapters, pitch and demo.
- **Human lead:** local AI, `src/lib/ai/**`, Supabase, secrets, deploy decisions and final merges.
- **GLM Flash:** independent simulation/fault-injection harness under `src/simulation/**`.
- **GPT Work:** independent QA/audit/release-readiness documents.

No Opus subagent may claim or edit those areas. Instead write the minimum interface requirement in your final handoff so the owner can connect it.

## Security and correctness gates

- Never let model text authorize side effects. Required approval is explicit, scoped, current and auditable.
- `REQUESTED` is not `CONFIRMED`; `READY` requires every mandatory confirmation. Invalidate `READY` immediately when a ride or mandatory RSVP is withdrawn.
- Idempotency: replaying a provider event does not send another message or duplicate a decision.
- Preference updates remain proposed until confirmed.
- Existing `/api/analyze` continues to behave as before; no breaking schema changes.
- No real outgoing email/SMS/ride booking, payments or database migration. All demo provider calls must be mock-safe and labeled.
- **Never deploy, modify Vercel, push directly to main or merge PRs without lead approval.** Do not add packages or change other owner files without permission.

## Parent completion / report format

Return:
1. Subagents actually launched, each assignment and owned files (or explicitly state tooling unavailable).
2. Contract/API document and changes made; which interfaces are ready for Teammate A/B and GLM.
3. One combined end-to-end test trace, including blocked -> explicit consent -> pending -> READY -> cancellation -> NEEDS_REPLAN -> revised approval/confirmation -> READY -> reviewable feedback.
4. Exact output from `npm run check` and `npm run build` (or why blocked).
5. PR URL, untouched human-owned paths, mock/live distinctions, blockers and top remaining risks.

**Stop condition:** the P0 coordination loop is correct, testable, reproducible offline, and documented. Prioritize parallelism and shipped evidence over speculative infrastructure.
