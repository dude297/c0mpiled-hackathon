# DayBridge — Agent Playbook

**Status:** hackathon work agreement (updated 2026-10-17). This supplements root `AGENTS.md`, `CLAUDE.md`, and the active human assignments in `docs/handoffs/`. Never remove the auto-generated Next.js section in root `AGENTS.md`.

## Source of truth and implementation status

- Product intent and P0 requirements: `docs/daybridge/PRODUCT_ENGINEERING_SPEC.md`.
- Working baseline: Next.js 16 / React 19 / TypeScript / Zod / Vitest. `src/domain/engine.ts` ranks activities and identifies barriers; `/api/analyze` works; `src/lib/ai/adapter.ts` provides local-model-compatible explanation with fallback.
- **Proposed, not yet shipped:** approval-gated coordination, durable event states, provider confirmations, cancellation recovery, confirmed preference learning. No document or pitch should imply these exist before merged tests demonstrate them.
- Keep the existing `ScenarioInput` / `AnalysisResult` contracts and baseline tests functional. All new endpoints must use additive schemas and clear fixture/mock labeling.

## Human team owns these files and deliverables — AI agents must not duplicate them

| Owner | Exclusive scope | Files / deliverables |
|---|---|---|
| Teammate A | UI/UX, accessibility, layout, frontend endpoint wiring | `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/**` |
| Teammate B | Real activity data, third-party integrations/handoffs, demo profiles, pitch/slides/video/rehearsal | `src/domain/activities.ts`, new `src/integrations/**`, optional `src/app/api/integrations/**`, `docs/handoffs/teammate-b-integrations.md`, demo and pitch |
| Human lead | Supabase save/share, local AI model endpoint/intake, secrets, architectural decisions and merges | `src/lib/ai/**`, `src/app/api/intake/**`, `src/app/api/plans/**`, `src/app/plan/**`, `src/lib/supabase.ts`, `supabase/**`, `.env.example`, deployment decisions |

These are **reserved**, not available to an AI agent by default. If a change is needed, supply a small interface request to its owner rather than editing that owner's files. Teammate B builds external provider connectors/handoffs only after agreeing on Opus's `ProviderPort` contract. Lead retains secrets, Supabase, local AI, and approval of any external side effects.

## Non-negotiable engineering rules

1. One owner per file, isolated branch per agent, reviewable PRs. Never push to `main`, auto-merge or deploy without explicit human approval.
2. Deployment quota is scarce. Preserve `vercel.json` auto-deploy restrictions; never connect, push to or deploy with a hosting provider without approval.
3. Correctness-critical decisions belong to deterministic `src/domain/` logic; model text never creates unverified facts, confirms a ride, overrides a hard barrier or infers consent.
4. Side effects require an explicit, unexpired approval scoped to actor, recipient, action, exact information shared, and intended time. Approval cannot be inferred by the LLM.
5. `REQUESTED` is not `CONFIRMED`, `CONFIRMED` is not `ATTENDED`, and `READY` requires every dependency confirmed. On cancellation, `READY` must be revoked immediately.
6. Provider callbacks need stable idempotency keys and event evidence. Never claim real confirmations from a simulated provider.
7. Feedback generates a proposed preference patch; apply it only after the user confirms.
8. Local-first, reproducible and privacy-safe: no external messages, payments, real bookings or sensitive personal information in mock workflow tests. Read-only third-party sources should preserve provenance, URL and checked time; estimated venue details are not verified live information.
9. No new npm packages, databases, auth, infra, or UI/pitch features without lead approval. Maintain future pivot flexibility.
10. Tests prove behavior. Before a coding PR: `npm run check`, `npm run build`, plus precise repro instructions. Disclose failures and unverified assumptions.

## AI workstreams — non-overlapping ownership

### Claude Opus 5.5 — deterministic coordination engine and contracts

**P0 PARALLEL-EXECUTION DIRECTIVE:** Read [OPUS_SUBAGENT_ADDENDUM.md](OPUS_SUBAGENT_ADDENDUM.md) before implementation. If subagent tooling exists, launch independent workers promptly for state transitions, consent, event idempotency, API handlers, adversarial unit tests and read-only review. Freeze the typed contract first, give each writer disjoint paths, and integrate centrally. Parent Opus remains accountable. Do not subdelegate into teammate/GLM/GPT Work paths or claim unavailable subagents were started.

**Own:** `src/domain/coordination/**`, `src/app/api/coordination/**`, additive changes to `src/lib/schema.ts`, and unit tests colocated with the new coordinator. May write `docs/daybridge/COORDINATION_CONTRACT.md`.

**Do not touch:** human-owned UI/catalog/integrations/AI/Supabase files, `src/simulation/**` (GLM), GPT Work documents, or existing `src/domain/engine.ts` unless the lead approves a narrow patch. Publish `ProviderPort` and event/approval contracts for Teammate B's external connections; adapters never determine authoritative READY themselves.

**Sequence:**
1. Publish a small, versioned Zod contract: plan/intervention/approval/dependency/event/preference patch, and request/response examples. Notify all owners.
2. Implement a pure state machine and constraints. Plan states must distinguish blocked, proposal, waiting for consent, pending provider confirmation, ready, needs replan, and completed.
3. Define injectable `ProviderPort` interface. Keep in-memory test doubles within Opus's own coordinator test files; GLM independently develops the reusable simulation adapter under its own path.
4. Add scoped consent validation, idempotent event handling, cancellation invalidation, recovery suggestions, and approved feedback patch application.
5. Provide a minimal coordination API using mock-safe event submission. Never dispatch real external messages or bookings. Preserve existing analysis endpoints and tests.

**Acceptance:** `READY` is impossible without confirmations, missing/stale consent is rejected, duplicate callbacks do not double-act, cancellation invalidates READY, feedback cannot silently change preferences, and regression checks pass.

### GLM-5.3 Flash — simulation harness, integration tests and failure injection

**Own:** new `src/simulation/**` and `docs/daybridge/SIMULATION_GUIDE.md` only. Add tests inside `src/simulation/**`. This is backend QA tooling **not UI and not the real activity catalog**.

**Do not touch:** `src/domain/activities.ts`, `src/integrations/**`, `src/app/api/integrations/**`, `src/domain/coordination/**`, `src/lib/schema.ts`, `src/lib/ai/**`, human UI files, or deployment.

**Sequence:**
1. Before Opus's API is frozen, implement baseline regression tests around existing `runScenario` with inline synthetic profiles and activities (no modification to the human-owned catalog).
2. After Opus publishes `COORDINATION_CONTRACT.md`, write deterministic provider fixtures for invitation and ride replies: accepted, declined, timed out, late reply, duplicate, cancelled, and conflicting/out-of-order callbacks.
3. Build an event-replay simulator using `ProviderPort` with a fixed seed/clock as needed; keep fixtures isolated from real services.
4. Write integration tests for blocked -> proposal -> approval -> pending -> READY -> cancellation -> NEEDS_REPLAN -> reapproval -> READY -> proposed feedback patch -> confirmed patch. Test unauthorized outbound action and false READY.
5. Report tests with exact command outputs; create one narrow PR with simulation and tests.

**Acceptance:** repeatable offline runs, no live data or network side effects, robust failure injection, zero overlap with teammates' files or Opus's code.

### GPT Work — independent systems QA, integration risk, acceptance gate

**Own:** `docs/daybridge/EVALUATION_MATRIX.md`, `docs/daybridge/THREAT_AND_FAILURE_REVIEW.md`, `docs/daybridge/INTEGRATION_CHECKLIST.md`, and PR review notes. No source-code modifications by default.

**Do not own:** slides, pitch, demo video or runbook, activity research/catalog, third-party integrations, UI, Supabase implementation or AI adapter. Those belong to teammates/lead.

**Sequence:**
1. Audit actual repository implementation against P0-1 through P0-8, marking implemented/partial/missing with file paths.
2. Identify state, consent, privacy, accessibility, integration, mock/live provenance, bad external data, and local-model availability risks; offer concrete verification steps.
3. Review Opus's contract and GLM's tests independently for correctness gaps, file-ownership conflicts and untested boundary conditions.
4. Create an integration gate: branch order, contract freeze, `npm run check`, `npm run build`, local inference/fallback honesty, provider mock evidence, deploy budget, and rollback plan.
5. Provide the lead a short GO / NO-GO assessment with blockers and concrete requests for the responsible teammate. Do not make pitch materials for Teammate B.

**Acceptance:** traceable repo evidence, clear false-ready/consent threat cases, ownership-aware task requests, independently verifiable release checklist.

## Parallel execution and dependencies

1. **Immediately:** GPT Work audits the baseline; GLM runs independent baseline regression/failure test preparation; Opus freezes the coordination contracts; Teammate B researches real data/provider permissions and implements a read-only external handoff.
2. **After contract freeze:** GLM implements simulated provider adapter + coordinator integration tests; Teammate B may implement one sandbox-only/consent-gated provider adapter against Opus's frozen `ProviderPort`; Teammate A integrates endpoints in the UI only through their assigned branch; human lead retains local model and Supabase.
3. **PR order:** Opus contract/core -> GLM simulator/tests and Teammate B external read-only connection/provider bridge -> Teammate A UI integration -> Work acceptance report; order can change if dependencies demand it. No bot pushes to main.
4. **Lead approves:** integration, full `npm run check` and `npm run build`, offline recovery trace, human demo/pitch rehearsal, and any deploy.
5. If scope must shrink, prioritize an end-to-end feasible plan with auditable blocked/approved/confirmed states over P1 embellishments.

## Handoff format

Each PR or agent report must give: goal; exactly owned files changed; baseline/branch; completed vs mocked; tests and exact outputs; risky assumptions; open blockers; next owner; and whether deployment occurred (default: no).

## P0 stopping point

Stop new work once the app + offline simulator reliably proves: a hard barrier is not ignored; a proposed intervention is explicitly approved; providers can be pending and then confirmed; READY requires all dependencies; a simulated ride cancellation invalidates READY; recovery requires new approval if scope changes; and feedback modifies preferences only after confirmation.
