# DayBridge simulation & QA guide

Owner: simulation/reliability/testing engineer (GLM workstream). This guide covers
`src/simulation/**` only — backend QA tooling. It does not describe UI, the real
activity catalog, the AI adapter, or the coordination engine internals.

## Principles

- **Synthetic fixtures only.** Tests must never depend on or modify
  `src/domain/activities.ts` (owned by Teammate B). Plan-level tests inject inline
  fixtures with `vi.mock("@/domain/activities", …)` and always call the REAL
  `runScenario` / `checkActivity` from `src/domain/engine.ts` — no re-implemented
  engine logic anywhere in the harness.
- **Real coordinator.** Phase 2 tests drive the actual coordination engine
  (`src/domain/coordination/coordinator.ts`) through its public surface
  (`create` / `command` / `ingest` / `get`). The harness cannot bypass the approval
  system or fabricate authoritative states.
- **Deterministic.** No randomness, no wall-clock (fixed clock via `now: () => new Date(t)`),
  no network. Repeated runs give identical results.
- **No false success.** Every test asserts negative space too: what must NOT appear
  in a plan, what must be blocked, what evidence must be unverified, what must never
  be READY.
- **Isolation.** Nothing here imports production data or hits real services. Provider
  doubles are injected via `createCoordinator({ provider })`; production code never
  sees them.

## Layout

```
src/simulation/
  engine-baseline.test.ts     Phase 1: regression + edge-case tests for runScenario/checkActivity
  coordination-sim.test.ts    Phase 2: adversarial provider-event simulation against the coordinator
```

## Phase 1 — engine baseline (done)

Tests in `src/simulation/engine-baseline.test.ts`, grouped:

| Group | What it locks in |
|---|---|
| mobility/accessibility | walker & wheelchair + stairs = hard block; cane = soft with mitigation; step-free passes all |
| transportation | no overlapping mode = hard block; route over limit = hard; exact-limit is feasible; independent mode preferred over family ride; walk excluded when mobility forbids it |
| schedule | no time overlap = hard block; one activity per day enforced in plans |
| budget | over-budget = hard block; cumulative spend ≤ budget; zero budget still plans free activities; greedy prefers affordable highest-score |
| interests | no overlap → empty plan, no blocked list, no fabricated evidence |
| determinism | identical input → identical output; lexicographic tiebreak on equal scores; travel time breaks score ties; soft barriers lower rank; plan caps at 3 (MAX_PLAN) |
| evidence | planned items always have verified claims; blocked items only unverified ones; nothing references activities outside the catalog; infeasible never shown as planned |
| invalid input | engine degrades gracefully (structured empty result, no crash) on empty times, zero maxTravelMin |

Fixture injection: a hoisted mutable array is swapped per test via `vi.mock`, so
`runScenario` itself runs unmodified against synthetic catalogs.

Run them:

```bash
npx vitest run src/simulation/engine-baseline.test.ts
```

## Phase 2 — coordination simulation (done, PR #3 engine)

Tests in `src/simulation/coordination-sim.test.ts` driving the real coordinator
(`createCoordinator({ provider, now, activities, newId })`) through
`.create` / `.command` / `.ingest` / `.get`, with `readyViolations` used for
false-READY detection.

Provider failure is modeled exactly as the contract prescribes:
- a port that **throws** (network error → action stays approved, retry deduped),
- `createMockProvider({ fail })` (provider reports `status: "failed"` at dispatch),
- `ride.cancelled` / `ride.declined` / `invite.declined` **events** after dispatch.

There are no "timeout"/"delayed" event types in the contract; delay scenarios are
expressed as the fixed clock advancing past an approval's `expiresAt` (stale
approval) and as out-of-order/stale `sequence` values.

| Coverage area | Tests |
|---|---|
| ride confirmed / friend accepts | golden path (BLOCKED → READY → COMPLETED) |
| ride cancelled after READY | `plan.ready_revoked` + `plan.replan_required`; paratransit recovery |
| friend declines | decline-after-accept = cancelled per contract §3, READY revoked |
| provider unavailability | dispatch throws → stays AWAITING_APPROVAL, retry deduped by idempotency key |
| repeated callbacks | duplicate by eventId and by idempotencyKey; confirmed dep never flips |
| out-of-order events | stale/lower/equal sequence ignored; never downgrades state |
| late confirmation after cancellation | ignored (superseded request); READY impossible |
| failed external request | provider `failed` result → immediate NEEDS_REPLAN with recovery |
| revoked / expired approval | atomic execute blocked, nothing dispatched, zero provider calls |
| no feasible recovery | both ride sources die → hard transport blocker, alternatives, accept rejected |
| preference confirmation | patch proposed only, profile mutated only on `confirm_preference`; double-confirm idempotent |
| false-success detection | partial confirmation ≠ READY (`readyViolations` > 0); rejected events change nothing |
| determinism | identical sequences → identical plans; strictly increasing event seq; every result schema-parses |
| carry-over | confirmed invite survives ride-cancel replan, never re-sent |

Run everything:

```bash
npx vitest run src/simulation/   # all simulation tests
npm run check                    # full gate (typecheck + lint + all tests)
```
