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

## Phase 2 — coordination simulation (PR #3 engine)

18 tests in `src/simulation/coordination-sim.test.ts` driving the **real** coordinator
(`src/domain/coordination/coordinator.ts`) through its public surface
(`create` / `command` / `ingest` / `get`) with a fixed clock and the injectable
`ProviderPort`. No reimplementation, no network, fully offline.

| Coverage area | Tests |
|---|---|
| Ride confirmed / friend accepts | golden path (BLOCKED → READY → COMPLETED) |
| Ride cancelled after READY | `plan.ready_revoked` + `plan.replan_required` asserted; paratransit recovery |
| Friend declines | decline-after-accept treated as cancelled per contract §3, READY revoked |
| Provider timeout / unavailability | dispatch throws → stays AWAITING_APPROVAL, retry deduped by idempotency key |
| Repeated callbacks | duplicate by eventId and by idempotencyKey; confirmed dep never flips |
| Out-of-order events | stale/lower/equal sequence ignored; never downgrades state |
| Late confirmation after cancellation | ignored (superseded request); READY impossible |
| Failed external request | provider `failed` result → immediate NEEDS_REPLAN with recovery |
| Revoked / expired approval | atomic execute blocked, nothing dispatched, zero provider calls |
| No feasible recovery | both ride sources die → hard transport blocker, alternatives offered, accept rejected |
| Preference confirmation | patch proposed only, profile mutated only on `confirm_preference`; double-confirm idempotent |
| False-success detection | partial confirmation ≠ READY (`readyViolations` > 0); rejected events change nothing |
| Determinism | identical command sequences → identical plans; strictly increasing event seq; every result schema-parses |
| Carry-over | confirmed invite survives ride-cancel replan, never re-sent |

Run them:

```bash
npx vitest run src/simulation/coordination-sim.test.ts   # Phase 2 only
npx vitest run src/simulation/                            # all simulation tests
npm run check                                             # full gate (typecheck + lint + all tests)
```

### Simulation principles (Phase 2)

- The simulator only ever calls the coordinator's public API — it cannot bypass the
  approval system or fabricate authoritative states because `ingest` routes every
  provider event through the same validation as the HTTP endpoint.
- Provider doubles are injected via `createCoordinator({ provider })`; production code
  never sees them.
- Findings against the engine are recorded as bugs in the PR, never papered over:
  tests document actual behavior and flag deviations from the contract for review.
