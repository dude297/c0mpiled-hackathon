# DayBridge — Agent Playbook

**Status:** active hackathon work agreement (2026-10-17). This document supplements, but does not replace, root AGENTS.md, CLAUDE.md and docs/handoffs. The existing Next.js-generated instructions in root AGENTS.md must remain intact.

## Source of truth and current state

- Product intent and P0 acceptance criteria: docs/daybridge/PRODUCT_ENGINEERING_SPEC.md. Quick navigation: docs/daybridge/README.md.
- Existing working baseline: Next.js 16 / React 19 / TypeScript / Zod / Vitest; src/domain/engine.ts already filters and ranks activities, src/lib/ai/adapter.ts already supports mock vs OpenAI-compatible local endpoint, and src/app/api/analyze is operational.
- **Do not misrepresent proposed features as shipped.** Approval-gated invitation/ride workflows, immutable event logging, cancellation recovery, and confirmed feedback are planned P0 extensions and require implementation and tests.
- Preserve src/lib/schema.ts contracts with existing /api/analyze and the dashboard while adding new schemas and routes. Get contract alignment before the UI agent consumes new endpoints.
- Older human workstream assignments in docs/handoffs may still be active. Never take a file that an active human teammate owns until the lead explicitly transfers that file to the AI agent.

## Non-negotiable rules

1. **One owner per file and one branch per agent.** Open a PR; never push directly to main, auto-merge or deploy. Lead reviews integration.
2. **Protect deploy quota.** Never connect hosting or run vercel deploy without explicit human approval. Keep vercel.json auto-deployment disabled.
3. **Proof before polish.** npm run check and npm run build must pass before a code PR is review-ready. Include reproduction steps and screenshots when relevant.
4. **Pure deterministic correctness core.** Models may parse or explain; only domain logic decides hard-constraint feasibility, approvals, and READY.
5. **Specific authorization for side effects.** Contacting anyone, sharing information, booking, or spending requires a consent record scoped to target, action, payload and expiration. Consent cannot be inferred from a conversational guess.
6. **External responses are evidence, not wishes.** Requested is not confirmed. RSVP is not attendance. READY requires all currently required dependencies confirmed.
7. **Reversible and observable.** Any ride/required-RSVP loss invalidates READY. Log the event, recalculate, and request approval for changed action scope. Feedback generates a proposed preference patch until user confirms.
8. **Offline-first demo.** Keep deterministic fictional fixtures and labeled mock providers. No live third-party credentials, payment, personal data, or production transportation booking in the golden path.
9. **Minimize scope.** No payments, broad marketplace, auth, Supabase migrations, additional packages or infrastructure unless explicitly approved. Preserve AskFirst/GhostProtocol pivot flexibility.
10. **Security and accessibility.** Never commit secrets; preserve server-only env vars. Make the UI keyboard usable with clear statuses and distinguish simulation from live evidence.

## Workflow and ownership (three parallel agents)

### Claude Opus 5.5 — systems architect / correctness-critical engineer

Own: new src/domain/coordination/**, new src/app/api/coordination/**, additive schema changes in src/lib/schema.ts, and their dedicated tests. Does not own page.tsx or components. Preserve existing runScenario output.

Deliver: (1) versioned typed plan, intervention, approval and event contracts; (2) finite deterministic plan state machine; (3) explicit approval policy and idempotent mocked invite/ride commands; (4) proof that READY is impossible without confirmations; (5) cancellation invalidation and reprioritized recovery options; (6) proposed preference updates requiring confirmation; (7) minimal API contract documented before GLM integration.

Acceptance: tests for impossible hard constraints; unauthorized outbound action; pending vs confirmed; duplicate adapter callbacks; ride cancellation READY -> NEEDS_REPLAN; stale approvals; preference confirmation and reranking; and preserved legacy API tests.

### GLM-5.3 Flash — frontend and demo experience

Own only if human UI workstream is inactive or reassigned: src/app/page.tsx, src/app/globals.css, src/components/daybridge/** (new), and UI-only tests. Do not modify coordination engine, schemas, or APIs. For existing src/components/dashboard/** obtain explicit ownership from lead first.

Deliver: an accessible 4–5 minute guided experience with a profile, selected activity, visible blocker explanation, minimum-change proposal, specific consent action, pending/confirmed statuses, intervention timeline, simulated ride cancellation, replan, and reviewed preference patch. Make state clearly traceable; label all provider responses MOCK. Retain current /api/analyze panel or provide an obvious way to access it.

Acceptance: golden scenario can be rehearsed from reset to recovery without a live service; responsive, clear empty/loading/error states, no optimistic READY; UI uses the Opus-frozen typed API contract. If that contract is unavailable, work on storyboard and static presentational components only.

### GPT Work — independent product QA, integration readiness and judging narrative

Own: docs/daybridge/EVALUATION_MATRIX.md, docs/daybridge/DEMO_RUNBOOK.md, docs/daybridge/JUDGE_NARRATIVE.md, and issue/PR review notes. No source-code edits unless lead grants an explicitly non-overlapping path.

Deliver: a requirements-to-tests matrix mapping P0-1..P0-8 to evidence; adversarial failure cases and how to reproduce them; reproducible offline 4–5 minute script with clear before/after, interruption/recovery and local-inference disclosure; acceptance checklist with mock/live boundaries; concise pitch, credible metrics and fallback demo plan.

Acceptance: call out unimplemented features instead of assuming the product is complete. Inspect merged changes and provide a PASS/BLOCKED table, commands to run, and concrete blockers. Do not assert tests or hardware work unless verified.

## Parallel sequence and integration

1. Lead confirms who owns UI/data files and freezes scope for the event.
2. Opus publishes typed schema, events and endpoint examples first; GLM builds presentational pieces against that contract. GPT Work drafts test scenarios and rubric in parallel.
3. Opus opens a focused PR with tests; lead merges only after npm run check and npm run build pass.
4. GLM rebases on the merged contract, connects UI, and opens a separate PR. GPT Work reviews behavior and prepares the demo runbook.
5. Lead integrates, runs full offline golden path twice, and authorizes any hosted deployment explicitly. Keep the local fallback ready.

## Universal agent handoff format

For every session/PR provide: goal, files changed, assumptions, what is implemented vs mocked, tests run with exact output, known risks, next owner and blockers. No claims of completion without executable proof.

## P0 stop condition

Stop adding features once the offline demo demonstrates: blocked -> proposed intervention -> scoped consent -> confirmed READY -> ride cancelled -> NEEDS_REPLAN -> revised consent/READY -> feedback patch proposed/confirmed, with every transition audit-visible and no hard-constraint/consent violation.
