# DayBridge — Copy/Paste Agent Tasks

Repo: https://github.com/dude297/c0mpiled-hackathon
Read first: AGENTS.md, CLAUDE.md, docs/daybridge/PRODUCT_ENGINEERING_SPEC.md, docs/daybridge/AGENT_PLAYBOOK.md, docs/handoffs/README.md.
**Important:** As of 2026-10-17, the complete DayBridge documentation is being proposed on branch docs/daybridge-spec-agent-plan-20261017; use that branch for reading until its PR is merged. All code branches should start from the latest approved main. No push to main or deploy without human approval.

## Task A — GPT Work (product QA / demo owner)

> Audit the existing DayBridge prototype against P0-1 to P0-8 in docs/daybridge/PRODUCT_ENGINEERING_SPEC.md. Do not claim planned features exist. Produce docs/daybridge/EVALUATION_MATRIX.md with exact source references, reproducible tests and PASS/PARTIAL/MISSING status. Produce docs/daybridge/DEMO_RUNBOOK.md (offline 4–5 minute demo, exact clicks and expected states, failure/recovery, mock vs live disclosures, fallback rehearsal) and docs/daybridge/JUDGE_NARRATIVE.md (problem, differentiation, measurable outcome, local-AI justification, three judge questions). Add adversarial test cases for unauthorised messages, stale confirmation, ride cancellation, duplicate callbacks and preference review. Do not modify source code, deploy, or change hosting. Open a docs-only PR and hand off integration blockers.

Acceptance: grounded repo audit, every P0 item accounted for, rigorous STOP/GO checklist, and demo script that does not depend on unbuilt features or third-party credentials.

## Task B — Claude Opus 5.5 (systems / workflow core)

> You own DayBridge Unlock's correctness-critical coordination core. Preserve the existing Next.js/TypeScript activity analysis and /api/analyze contract. Read the product specification and agent playbook. First write a minimal typed RFC with additive Zod schemas and endpoint request/response examples for profile constraints, intervention candidates, consent scopes, plan events, dependencies and preference patches. Implement src/domain/coordination/** and src/app/api/coordination/** with a deterministic state machine, audited approval gates, idempotent mock invite/ride adapters, READY confirmation invariants, revocation to NEEDS_REPLAN when dependencies fail, and confirmed feedback updates. Limit files to those paths plus src/lib/schema.ts and dedicated tests. Collaborate on API design with the UI agent; no direct UI edits. Add Vitest cases for hard constraints, missing consent, pending vs confirmed, stale approval, ride cancellation, duplicate callbacks and preference learning. Run npm run check and npm run build, report results, and open a PR. Do not deploy or add packages without approval.

Acceptance: tests prove no unauthorized actions or false READY; the old /api/analyze remains backward-compatible; the workflow can run entirely with mock providers offline; the API is fully typed and documented.

## Task C — GLM-5.3 Flash (UI / interactive demo)

> You own a focused, accessible DayBridge Unlock demo UI, not the coordination engine. Before edits, confirm the human UI teammate has released ownership of src/app/page.tsx, src/app/globals.css and relevant components. Read the repo rules and current screen implementation. Start with static presentational components in src/components/daybridge/** while Opus freezes the new typed API. Then wire the main page and UI to those endpoints without faking READY or making outbound calls outside the consent flow. Show Maya's activity, blockers, proposed minimum intervention, action approval, pending invitation and ride confirmations, READY, simulated cancellation / NEEDS_REPLAN, revised plan, and a proposed feedback change requiring explicit confirmation. Label every mock provider response as simulated. Retain the existing analysis journey, polished typography, keyboard navigation, high contrast, loading/error/reset states, and a repeatable demo sequence. Add UI tests if feasible. Run npm run check and npm run build, report results and open a UI-only PR. No new dependencies, infrastructure, or deployments.

Acceptance: judge understands blocked -> ready -> disrupted -> repaired -> learned within 4–5 minutes, while UI remains consistent with actual backend state. No touching Opus-owned files.

## Lead integration checklist

- Confirm any human teammates' active file ownership before transferring files to an AI agent.
- Approve Opus contract before GLM connects to it.
- Merge only passing PRs; prefer coordination core first, UI second, Work evaluation third.
- Run npm run check, npm run build, and the complete offline flow twice; explicitly verify mock/live labels and approval scopes.
- Rehearse a local inference demonstration only when hardware and endpoint actually work. Never imply on-device inference if using a cloud API or mock.
- Human approval required before creating a release branch or deploying.
