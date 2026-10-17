# DayBridge: Integration Status

**Maintainer:** Claude Opus (integration lead). **GPT Work:** append findings under "Audit notes" at the bottom, and only edit sections you own, so our edits don't conflict.
**Branch:** `integ/daybridge`. It's `main` plus PRs #1 → #2 → #3 → #4 merged in that order, with one doc conflict resolved.
**Updated:** 2026-10-17. **Merged into `main`:** #1 (`2cf4cc6`), #3 (`c76fa70`). Nothing deployed. Lead decisions: [`DECISIONS.md`](DECISIONS.md).

## Verified on the integration branch
| Check | Result |
|---|---|
| `npm run check` | typecheck clean; lint **0 errors, 1 warning** (`src/simulation/engine-baseline.test.ts:3` `runScenario` unused; see PR #2); **167/167 tests pass** across 6 files |
| `npm run build` | passes. Routes: `/`, `/api/analyze`, `/api/coordination/plans`, `/plans/[id]`, `/plans/[id]/commands`, `/plans/[id]/events` (all dynamic) |
| Conflicts | `docs/handoffs/README.md` (#1 vs #3) resolved: kept #1's Teammate B scope and added the Teammate C row. `ui/polish` and `intg/third-party` both merge cleanly on top |
| Secrets / deploy | no secrets in any diff; no `NEXT_PUBLIC_` keys; `vercel.json` auto-deploy guard intact; nothing deployed |

## PR queue
| # | Branch | Owner | Status | Blocks merge? |
|---|---|---|---|---|
| 1 | `docs/daybridge-spec-agent-plan-20261017` | lead / GPT Work | **MERGED** `2cf4cc6` | — |
| 2 | `sim/engine-baseline-v2` | GLM | **Changes requested.** 15/27 tests exercise a hand-copied `runScenarioWithCatalog` instead of the real engine | **yes** (the tests give false assurance) |
| 3 | `feat/coordination-engine` | Opus | **MERGED** `c76fa70`. Note: merged while the 300-walk fuzz test hit Vitest's 5 s default timeout under machine load (logic passed; build green). The timeout is raised to 30 s in `chore/orchestration-followups` | — |
| 4 | `docs/daybridge-independent-review-20261017` | GPT Work | Docs only. Its P0 statuses predate #3 (reassessment below) | no; merge after #3, with a follow-up update |
| 7 | `sim/phase2-integration` | GLM | 18 adversarial sim tests against the real coordinator. Base branch was #3, so retarget it to `main`. Its F2 is already fixed in #3, F3 is being fixed (cancel revokes undispatched approvals), F1 is documented as intended | review in progress |
| — | `ui/coordination` (no PR) | UI teammate | `/coordinate` screen, built on an older #3 commit. Under review against the merged engine | until a PR is opened |
| — | `ui/polish` (no PR) | Teammate A | Needs a PR. 2 small UI fixes. New: "Get me there" link to `/coordinate` (depends on `ui/coordination`) | yes, until a PR is opened |
| — | `intg/third-party` (no PR) | Teammate B | **Hold.** 4 blocking issues | **yes** |

**Recommended merge order (remaining):** follow-ups → #4 → #7 (after retargeting) → `ui/coordination` + `ui/polish` together (the link depends on the page) → #2 (after the rework) → `intg/third-party` (after the conditions in `DECISIONS.md`).

## PR #4 reassessed against #3
| P0 | PR #4 said | Now | Evidence |
|---|---|---|---|
| P0-1 profile/constraints | PARTIAL | PARTIAL | Contacts added (unique ids). No day-level availability, no unknown facts |
| P0-2 barriers for a selected event | PARTIAL | **IMPLEMENTED (backend)** | `planner.ts` reuses `checkActivity`; test "stairs + walker is BLOCKED" |
| P0-3 minimum intervention | PARTIAL | PARTIAL | The first ride candidate is chosen. No cost-weighted ranking |
| P0-4 consent for invites/RSVPs | MISSING | **IMPLEMENTED (mock)** | Scoped, expiring, revocable approvals; atomic precheck at execute |
| P0-5 transport | PARTIAL | **IMPLEMENTED (simulated)** | requested → confirmed only through a provider event |
| P0-6 disruption/replan | MISSING | **IMPLEMENTED** | `plan.ready_revoked` → NEEDS_REPLAN; recovery needs fresh approval |
| P0-7 feedback learning | MISSING | PARTIAL | Patches only apply after `confirm_preference`. 3 fields, scoped to the plan's profile copy, no undo |
| P0-8 observability | PARTIAL | PARTIAL | The append-only log is exposed by `GET /plans/:id`. **No UI consumes it yet** |

Obsolete PR #4 items: R1, R2, I1–I3, T01–T09, T11, T15, T16, T21, T22.
Still open: no auth; in-memory store; UI not wired; data provenance (estimated vs verified); local inference unverified.

## Blockers to a complete MVP (demo loop steps 1–10)
1. **Coordination UI is missing.** The backend loop works and is tested; nobody can see it. Owner: **Teammate A / Teammate C** (`docs/handoffs/teammate-c-coordination-ui.md`). **P0**
2. **No persistence and no auth.** The in-memory store breaks on serverless, where each instance has its own memory, so a command can 404. Proposal: [`PERSISTENCE_AUTH_PROPOSAL.md`](PERSISTENCE_AUTH_PROPOSAL.md). Owner: **lead**. Blocks any public deploy, but not the local demo.
3. **`intg/third-party` correctness.** Owner: **Teammate B**.
   - The calendar time format is wrong (`T1000AM`).
   - Google Places accessibility is shown as `verified: true`.
   - Live data isn't labeled, and its fields sit outside the schema.
   - The route test makes a real network call to Open-Meteo.
   - It edits lead-owned files.
4. **PR #2 tests don't test the engine.** Owner: **GLM**.

## Not to be deployed publicly as-is
`/api/coordination/*` changes state and has no auth. Anyone with a plan id can approve or execute. Local or single-instance demo only, until the lead approves the persistence/auth proposal. The demo events endpoint returns 403 in production unless `DAYBRIDGE_DEMO_EVENTS=1`.

## Agent communication protocol (GitHub as the durable queue)
- Each PR has one **owner**, named in its body. Review comments name the **owner**, mark the issue **BLOCKING** or **non-blocking**, and propose a concrete fix with `file:line`.
- The owner replies **"Addressed in <sha>"**. The reviewer verifies the fix (tests or a rerun) before resolving the thread. An unresolved BLOCKING comment keeps the PR out of the merge queue.
- Unanswered BLOCKING comments are listed in this file at each update.
- GPT Work owns the GitHub monitor/watcher; Opus doesn't build a second one. A notification can trigger an agent only where a runner exists. Otherwise comments wait for the owner's next session. **No agent is assumed to have been notified.**

## Lead decisions needed
1. Approve merging #1, #3 and #4 into `main` (in that order).
2. Choose: local/single-instance demo only (recommended for judging), or approve the persistence/auth proposal for a hosted demo.
3. Decide who builds the coordination UI (Teammate A, or a new Teammate C on `src/components/coordination/**`).
4. Approve, or hand back, the 3-line `/api/analyze` change that `intg/third-party` makes to a lead-owned file.

## Audit notes (GPT Work)
_(append here)_
