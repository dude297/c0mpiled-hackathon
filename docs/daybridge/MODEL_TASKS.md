# DayBridge — Copy/Paste AI Agent Assignments (Human Workstreams Protected)

Repo: https://github.com/dude297/c0mpiled-hackathon

**Start here:** `AGENTS.md`, `CLAUDE.md`, `docs/handoffs/README.md`, `docs/daybridge/PRODUCT_ENGINEERING_SPEC.md`, and `docs/daybridge/AGENT_PLAYBOOK.md`.

**As of 2026-10-17:** docs are proposed in branch `docs/daybridge-spec-agent-plan-20261017` / PR #1. Read from there until the PR is merged. New code branches should start from latest approved `main`. Do not push to `main`, auto-deploy, connect Vercel/Netlify, or change hosting. Commit only to your feature branch and open a PR.

**Human team owns:** Teammate A all UI (page/layout/styles/components); Teammate B `src/domain/activities.ts`, real programs/demo profiles, pitch, slides and rehearsal; human lead `src/lib/ai/**`, intake, Supabase, save/share, secrets, final merges and deployment. AI agents may not duplicate or change these areas.

## Task 1 — Claude Opus 5.5: Coordination engine and safety-critical backend

> Act as senior backend architect for DayBridge Unlock. First inspect the actual repo and docs; distinguish implemented activity analysis from proposed coordination features. You own only `src/domain/coordination/**`, `src/app/api/coordination/**`, additive `src/lib/schema.ts` edits, local unit tests under your paths, and `docs/daybridge/COORDINATION_CONTRACT.md`. **First deliver the typed contract** (Plan, Intervention, Approval, ActionRequest, ProviderEvent, dependency status, preference patch and minimal API examples) for the lead/Teammate A/GLM to review. Then implement an auditable deterministic state machine, hard-constraint guards, action-scope/expiry consent checks, idempotent event handling, injectable ProviderPort interface, provider confirmation gating, `READY -> NEEDS_REPLAN` on cancellation, and proposed feedback requiring explicit confirmation. For tests, use minimal fakes local to your coordinator test files; do not build GLM's reusable simulator. No live messages, bookings, payments, deployment, or extra packages. Preserve current `/api/analyze` behavior and type contracts. Do not edit UI, real activity catalog, `src/lib/ai/**`, Supabase, or `src/simulation/**`. Run `npm run check` and `npm run build` and report exact outputs. Open a reviewable PR with a handoff and remaining integration requests.

**Definition of done:** no unauthorized action, no READY without all confirmations, duplicate/out-of-order event protection, revocation on cancellation, stale scope rejected, preferences unchanged until confirmation, baseline regression tests pass.

## Task 2 — GLM-5.3 Flash: Simulator, fault injection, automated QA

> Act as fast implementation/test engineer. Do **not** implement UI (Teammate A owns that), real program catalog, slides or demos (Teammate B owns those), AI adapter/Supabase (lead owns those), or coordinator internals (Opus owns those). You own only new `src/simulation/**` and `docs/daybridge/SIMULATION_GUIDE.md`. Start right now with synthetic regression test cases for existing `runScenario`: hard mobility access blocks, unaffordable program blocks, impossible travel, no matching interests, budget accumulation, stable deterministic ordering, and no false verified evidence. Do not touch `src/domain/activities.ts`: use inline synthetic fixtures. When Opus publishes `docs/daybridge/COORDINATION_CONTRACT.md`, implement a reusable deterministic mock ProviderPort and event replay scenarios (accept, decline, timeout, late response, duplicate, out-of-order confirmation, ride cancellation, stale approval) without hitting any real network. Write integration tests under `src/simulation/**` that verify `READY` and replan/feedback transitions through the public coordinator API and detect false successes. Use Vitest and already installed dependencies only. Run `npm run check` and `npm run build`, provide exact results and open a simulation-only PR. If the contract is not ready, limit your work to baseline tests plus proposed fixture formats; do not invent API shapes.

**Definition of done:** offline repeatable fault injection; no dependencies on real catalog or live providers; adversarial cases demonstrate approval, confirmation and cancellation behavior; no overlap with the human or Opus files.

## Task 3 — GPT Work: Independent technical review and integration gate

> Act as independent technical QA lead, not UI designer or pitch writer. Inspect the `dude297/c0mpiled-hackathon` repository and the active DayBridge PR. Respect human assignments: Teammate A owns UI; Teammate B owns real-world data, scenarios, slides, and pitch; human lead owns AI adapter, Supabase, and deployment. Own only `docs/daybridge/EVALUATION_MATRIX.md`, `docs/daybridge/THREAT_AND_FAILURE_REVIEW.md`, `docs/daybridge/INTEGRATION_CHECKLIST.md` and PR review notes. Build an evidence-linked gap analysis of P0-1 to P0-8 with IMPLEMENTED/PARTIAL/MISSING and concrete file paths. Challenge consent scope, READY invariants, cancellation/recovery, privacy boundaries, mock/live provenance, estimated vs verified activity data, flaky local inference and unsafe outbound actions. Propose specific adversarial tests and owner-tagged issues; review Opus contract and GLM simulator when available. Provide a release-gate checklist with build/test commands, offline fallback, source evidence, deploy quota, rollback, integration sequence, and final GO / NO-GO criteria. Do not author demo scripts, pitch slides, UI code, activity listings or AI/Supabase implementation. Do not assert a test was run unless you actually ran it. Open a docs-only PR with findings.

**Definition of done:** no duplicated teammate work, every P0 acceptance item accounted for, concrete risks and test proof requirements, explicit handoff to correct owners, honest GO/NO-GO assessment.

## Dependency graph

- **Now, in parallel:** Opus freezes the contract; GLM adds synthetic baseline regression tests; GPT Work audits the current repository.
- **When contract lands:** GLM builds event replay and fault injection; Opus finishes core correctness. Teammate A integrates only the agreed API contract; lead maintains local AI and Supabase.
- **Before presentation:** merge reviewed code, run `npm run check` / `npm run build`, test cancellation and approvals offline, then Teammate B owns presentation rehearsal. Human lead approves any release/deployment.

## Required PR handoff

Include (1) owning branch, (2) files changed, (3) what exists vs simulated, (4) checks run and output, (5) API contracts affected, (6) exact remaining requests to teammates, (7) blockers, and (8) confirmation that no deployment or main push occurred.
