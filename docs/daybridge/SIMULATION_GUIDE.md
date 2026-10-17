# DayBridge simulation & QA guide

Owner: simulation/reliability/testing engineer (GLM workstream). This guide covers
`src/simulation/**` only — backend QA tooling. It does not describe UI, the real
activity catalog, the AI adapter, or the coordination engine internals.

## Principles

- **Synthetic fixtures only.** Tests must never depend on or modify
  `src/domain/activities.ts` (owned by Teammate B). All profiles and activities used
  in simulation tests are inline, prefixed `synthetic-` / named clearly.
- **Deterministic.** No randomness, no wall-clock, no network. Repeated runs give
  identical results.
- **No false success.** Every test asserts negative space too: what must NOT appear
  in a plan, what must be blocked, what evidence must be unverified.
- **Isolation.** Nothing here imports production data or hits real services.

## Layout

```
src/simulation/
  engine-baseline.test.ts   Phase 1: regression + edge-case tests for runScenario/checkActivity
  (Phase 2, after COORDINATION_CONTRACT.md lands:)
  provider-fixtures.ts      Deterministic mock provider events (accept/decline/timeout/…)
  event-replay.test.ts      Integration tests against the public coordinator API
```

## Phase 1 — engine baseline (done)

27 tests in `src/simulation/engine-baseline.test.ts`, grouped:

| Group | What it locks in |
|---|---|
| mobility/accessibility | walker & wheelchair + stairs = hard block; cane = soft with mitigation; step-free passes all |
| transportation | no overlapping mode = hard block; route over limit = hard; exact-limit is feasible; independent mode preferred over family ride; walk excluded when mobility forbids it |
| schedule | no time overlap = hard block; one activity per day enforced in plans |
| budget | over-budget = hard block; cumulative spend ≤ budget; zero budget still plans free activities; greedy prefers affordable highest-score |
| interests | no overlap → empty plan, no blocked list, no fabricated evidence |
| determinism | identical input → identical output; lexicographic tiebreak on equal scores; soft barriers lower rank |
| evidence | planned items always have verified claims; blocked items only unverified ones; nothing references activities outside the catalog; infeasible never shown as planned |
| invalid input | engine degrades gracefully (structured empty result, no crash) on empty times, zero maxTravelMin |

Run them:

```bash
npx vitest run src/simulation/engine-baseline.test.ts
```

## Phase 2 — coordination simulation (blocked on contract)

Opus owns `docs/daybridge/COORDINATION_CONTRACT.md` and `src/domain/coordination/**`.
**Do not start Phase 2 until that contract is merged.** Planned coverage (per
`docs/daybridge/MODEL_TASKS.md`, Task 2):

- Provider event fixtures: invitation accepted/declined, ride confirmed/cancelled,
  delayed/timed-out responses, duplicate events, out-of-order events, stale approvals,
  provider unavailability, failed interventions needing replanning.
- Event replay with a fixed clock; offline golden path (blocked → proposal → approval
  → pending → READY → cancellation → NEEDS_REPLAN → reapproval → READY → feedback
  proposal → confirmed).
- Adversarial checks: no false READY, no double-action on duplicates, no unauthorized
  outbound action.
