# DayBridge Unlock — integration and release checklist

> **Current assessment update (2026-10-17):** This is a historical snapshot. Revised PR #3 is now merged on main `c76fa70`, implementing mock coordination, scoped approvals, confirmations, recovery and confirmed structured preference patches. Independently verified: current main + operations checks **140 tests pass** and production build passes; PR #7's real-coordinator simulation **18 tests pass** on that core. The historical cross-activity consent defect was verified fixed. UI, persistent/authenticated state, natural-language learning and genuine providers remain limitations. See the [current independent refresh in PR #8](https://github.com/dude297/c0mpiled-hackathon/blob/ops/pr-monitoring-20261017/docs/daybridge/INTEGRATION_QA_REFRESH.md). Do not use the missing-coordinator or old build-failure statements below as current findings.

Independent assessment, 2026-10-17. **Current decision: NO-GO for Unlock P0; 0/8 P0 requirements fully accepted.** Main is an activity-analysis prototype. Five requirements have partial baseline support and three are missing. See [evaluation matrix](EVALUATION_MATRIX.md) and [threat/failure review](THREAT_AND_FAILURE_REVIEW.md).

This report branch starts from approved main `26b976233f53d3dede16a92416258e8a3c464cdb`; the spec remains in unmerged PR #1, reviewed through `9e2ff2c10436bdb37bf34a0590479e11517c3ffb`. Source snapshot cutoff: fetched branch heads through integration `62aaa29156929d462ddd2f07986963d226f41cae` and simulation `c2bafd5841739774ba2ace0debb30fac88111789`. These three documents do not amend other owners' source or handoffs. Proposed decisions below need lead agreement; no implementation or merge is implied.

## Integration blockers and concrete decisions

| ID | Dependency / collision | Recommendation and accountable owner | Exit evidence |
|---|---|---|---|
| I1 | Opus contract and GLM provider simulator absent; GLM baseline suite published separately | Opus publishes `COORDINATION_CONTRACT.md` and versioned additive schemas first. GLM uses public contracts, not guessed imports; replace copied planner helper per R6. A/B review response/actions before wiring. | Reviewed contract examples plus request/error/event fixtures. Until available, coordinator integration verification is BLOCKED; baseline tests do not close it. |
| I2 | Spec section 9.2 uses `POST /api/plans` to create coordination plans; lead handoff uses same route to save `{profile,result}` and return `{id}` | Lead + Opus reserve existing lead namespace for save/share; prefer `/api/coordination/**` for stateful commands per playbook. Lead records chosen routes in contract/decision log. | One canonical method/path/request/response table; baseline `/api/analyze` unchanged. |
| I3 | `AnalysisResult.plan` is an array of weekly `PlanItem`; proposed coordinator `Plan` is one versioned mission with dependencies | Opus names new types distinctly and adds fields/contracts without changing required baseline fields. A/lead agree which selected `activityId` and confirmed profile version create the mission. | Compile and regression tests of legacy UI/API plus one selected-event coordinator request; no client-cast substitute for validation. |
| I4 | Spec proposes `src/ai`, `src/store`, `src/policy`, `src/missions`; ownership assigns `src/lib/ai/**` to lead and coordinator internals to Opus | Use existing adapter path and coordinator namespace. Lead chooses minimum sufficient state storage/replay semantics. Do not create parallel AI adapters, duplicate state machines or SQLite + Supabase stores for the same state. | Contract identifies one authoritative state owner, clock and ProviderPort; restart behavior explicitly tested/documented. |
| I5 | `ui/polish` save control calls missing endpoint | A owns `src/components/dashboard/panels.tsx:230–236` and `src/app/page.tsx:53–62` at `66bcd6c`: hide/disable actual PlanPanel save action until lead endpoint exists. Its separate unused SaveShareSlot guard does not guard PlanPanel. IntakeSlot remains disabled. | Endpoint capability check or explicit coming-soon state; enabled save succeeds on integrated branch. No UI edit by reviewer. |
| I6 | UI retains result while profile is edited or a later request fails | A binds visible result to submitted snapshot/version and invalidates stale results for save/approval. Lead verifies saved result belongs to that snapshot; future API should recompute/validate authoritative fields. | Analyze A -> edit B -> save/approve cannot associate A result with B. On UI branch, current `savePlan` posts current `profile` plus previous `result`. Source finding; no browser reproduction claimed. |
| I7 | `intg/third-party` inherits UI, edits lead-owned `.env.example`, and now adds Places/weather/Calendar plus `/api/analyze` changes | Lead settles ownership: integration plan says A / `src/lib/integrations/**`, refreshed playbook says B / `src/integrations/**`; analyze bridge needs an assigned API owner. Integrate shared UI ancestry once. Keep optional services out of P0 critical path. | No overlapping UI replay; R7–R10 addressed or enrichment disabled. Connector code is not verified live merely because placeholders or fetches exist. |
| I8 | B owns catalog; existing baseline tests hardcode Margaret/choir | B notifies lead before changing ids/profiles. GLM creates synthetic fixtures in its own path; lead/authorized engine owner maintains baseline tests. Opus must not take over catalog or engine without narrow approval. | Replacement catalog passes existing checks, with independent access/transport/cost invariants still meaningful. |
| I9 | Human handoff suggests guessed access as booleans; Unlock requires unknown/verified distinction | Lead/Opus agree runtime source/estimate/checked-at representation; B supplies evidence/unknowns; A labels them. Preserve legacy AI `dataSource` meaning. | Same response can truthfully say live AI + fixture activity + simulated ride; unknown access never grants READY. |
| I10 | Supabase proposal permits all-row SELECT and saves full profile/result; local-only claims conflict with remote inference/share options | Lead either omits P1 save/share or designs restricted redacted access and authority checks. Verify actual model location separately. B uses only verified capability descriptions. | T20 privacy checks if enabled; runtime/network evidence for local claim; no personal data in fixture tests. |
| I11 | No owner explicitly assigned changes to existing `/api/analyze` or `engine.ts` for coordinator bridge | Lead names one owner for any necessary narrow bridge; Opus stays additive until approved. Coordination endpoints can call a public domain seam without rewriting baseline API. | Explicit ownership in PR and small reviewed change; no simultaneous edits by A/lead/Opus to shared contracts. |

## Interface freeze requested from Opus and lead

This is a review request, not an invented implementation contract:

- Plan identity, owner/actor authority, selected activity, profile/fact version, state/version, required vs optional dependencies, source and freshness.
- Intervention candidates, hard pass/fail/unknown reasons and deterministic cost components including transport spend; proposed feasibility distinct from readiness.
- Approval actor, exact scope/payload disclosure, target, cost ceiling, expiry/revocation and revision binding. Never infer approval from model output or a UI flag.
- ProviderPort request acknowledgment (`requested`/`failed`) separate from evidence-bearing reply (`confirmed`/`declined`/`cancelled`/`unknown`); stable action/request/event ids and idempotency rules.
- Command/result/error shapes for conflict, invalid transition, stale approval and unknown plan. State update/log append and action dispatch concurrency/restart semantics.
- Timeline/snapshot response for A; mock/simulated identity for GLM; candidate preference patch with old/new/evidence/confidence/version and separate confirm/reject operations for lead/A.
- Demo event injection boundary and provider selection controlled by deployment configuration; client cannot choose live provider or forge authoritative state.

## Owner-specific action queue

| Owner | Next action | Required handoff |
|---|---|---|
| Claude Opus 5.5 | Freeze additive contract; implement bounded intervention solver, approval/dependency/state/event guards, cancellation/reapproval and confirmed preference application in assigned paths | Narrow PR with API examples, invariants, deterministic tests and exact checks; no live side effects; request lead approval for any baseline engine/API edits |
| GLM-5.3 Flash | Start synthetic baseline regressions; after freeze, implement reusable ProviderPort replay/fault fixtures and T01–T22 applicable tests | Simulation-only PR; fixed clock, call-count/log/state assertions; mark unavailable contract cases blocked, not passed |
| Human Teammate A | Consume canonical contract; add selected-event state, approvals, dependency labels, timeline and feedback review; correct missing-endpoint save/stale snapshot behavior | UI-owned PR; keyboard/focus/errors/status review and fresh-browser acceptance evidence on integrated branch |
| Human Teammate B | Supply field-level activity evidence and unknowns; preserve fixture IDs or coordinate changes; coordinate connector ownership under refreshed playbook with lead/A; fix venue/date/provenance issues if integrations are included | Catalog/source and agreed connector handoff; live integration claims require proof; presentation remains B's; reviewer does not write scripts/slides or collect programs |
| Human lead | Resolve route/state-store/ownership decisions; validate local runtime; retain mock fallback; resolve privacy/share design; coordinate merges and deployment budget | Decision log, runtime latency/output evidence, approved release SHA and rollback plan. Supabase and live providers remain optional until separately safe |
| Independent reviewer | Review published Opus contract/GLM tests against these oracles and reassess merged candidate | Update only assigned docs/PR review notes; current report cannot certify work not yet published |

## Merge and verification sequence

1. Lead approves PR #1 scope and resolves I2–I4 and I9–I11. These review docs may merge independently, with their pinned proposed-spec reference retained.
2. Opus publishes contract/core PR; A, GLM and lead review it. Freeze contract before independent provider fixtures/UI endpoint work. Keep schema additions backwards compatible.
3. GLM adds simulator/fault tests against that core. A integrates only agreed endpoints; B/lead integrate catalog/AI changes through their own branches. Save/share and Maps/Calendar are optional, independently gated work.
4. Lead assembles an integration candidate, accounting for UI ancestry on `intg/third-party`. Run checks/build on the resulting tree, not just individual branches. Review final changed paths, dependency/lockfile changes and secrets/config handling.
5. Independently verify READY/replan/learning and provenance through public API plus UI. Human-owned rehearsal is additional evidence, not a replacement for adversarial tests.
6. Lead alone decides merge/release/deploy. Pin approved candidate and last known-good commit. Documentation PR and green tests do not authorize deployment.

## Verification performed for this audit

Baseline source was inspected locally and through the dude297 GitHub connection. Node `v24.15.0`, npm `11.16.0`. No live AI credentials/provider operations were used. GitHub CLI's local token was invalid; connected GitHub reads worked. Publishing uses the connection matching repository owner `dude297`.

| Check | Result / limits |
|---|---|
| Clone + branch/PR inspection | Pins/cutoff recorded in matrix. Initial open-PR list contained PR #1 only; subsequent branch refresh found GLM baseline tests and additional integration source, both reviewed. No published coordinator contract or provider replay implementation found at cutoff. |
| Dependency setup | First sandboxed `npm ci --ignore-scripts --no-audit --no-fund` failed with EPERM directory creation. Same locked install with broader execution permission succeeded: `added 623 packages in 4m`, exit 0. No tracked dependencies changed; lifecycle scripts intentionally skipped. |
| `npm run check` — baseline | PASS, exit 0: type generation/typecheck, lint, `Test Files 2 passed (2)`, `Tests 12 passed (12)`, Vitest duration `1.68s`. Source remained unchanged. |
| `npm run check` — GLM snapshot | PASS, exit 0 on isolated archived `c2bafd5` snapshot reusing installed dependencies: `Test Files 3 passed (3)`, `Tests 39 passed (39)`, duration `632ms`. Lint: 0 errors, 1 warning (`runScenario` unused at test line 3). This is 12 baseline + 27 new tests; copied helper limits proof per R6. No full integration branch check is claimed. |
| `npm run build` — baseline | FAILED, exit 1 in sandbox: could not fetch Geist/Geist Mono from Google Fonts (`src/app/layout.tsx:2–13`). Broader-permission retry also FAILED, exit 1: Turbopack `Failed to write app endpoint /page`, CSS loader child `node process exited before we could connect to it with exit code: 0`. Report also warned about an ignored parent lockfile outside this Git repository. Root cause of second failure unresolved; no successful production build certified. Lead/A must reproduce on supported release host and resolve build/offline font dependency. |
| Targeted scratch probes | Executed against unchanged baseline TypeScript modules via TypeScript transpilation in a scratch loader outside repository; exit 0. These are observations/assertions, not a new committed regression suite or browser test. See results below. |
| Third-party scratch probes | Executed against copied source at `62aaa29`, exit 0; all Places/weather responses stubbed and clock fixed. Reproduced wrong forecast-day result, unrelated venue attachment and contradictory access evidence. Calendar output inspected; no Google account/calendar operation or browser acceptance test. |
| Genuine local inference / hardware | NOT RUN. Lead laptop model installation, performance and network location are unverified; handoff assertions not independently adopted. |
| Deployed Supabase/RLS / provider credentials | NOT INSPECTED. Proposed unsafe SQL is reviewed as a design risk only. |
| Browser / full Unlock sequence | NOT RUN. Coordinator, simulator and P0 UI are absent. Unmerged UI was source-reviewed only. |

Observed scratch-probe results (all model replies were stubs, no model/provider network calls):

```text
family-only Margaret: 2 activities; family 6 min / 8 min; transport evidence verified=true
unsupported availableDays/contacts removed by ScenarioInput parsing
fabricated "ride is booked ... attendance" text accepted as live; deterministic plan unchanged
object-valued model content accepted as "[object Object]", labeled live
synthetic inference failure -> mock explanation; identical deterministic plan
malformed request JSON -> HTTP 400
integration: Monday rain at forecast date index 2 -> "No rain forecast for Mon."
integration: unrelated venue + stepFree=false attached; seeded access pass retained
integration: Calendar dates = 20261019T1000AM/20261019T1200PM
```

To reproduce current findings, use a synthetic copy of `DEMO_PROFILES.margaret` with `transport: ["family"]` in `runScenario`; inspect plan barriers/evidence. Stub `fetch` for `POST /api/analyze` with `AI_BASE_URL` set and return `choices[0].message.content` containing either a false booking claim or an object. Compare resulting plan to direct deterministic output and inspect explanation/source. For integration probes, call `enrichResult` with Monday garden plan and a Saturday-start `daily.time` array whose Monday code is rainy; then stub Places first result as an unrelated venue with inaccessible entrance and compare plan/evidence. Freeze clock to 2026-10-17 and inspect `calendarLink` output. Do not point these tests at live providers. GLM should turn these into permanent tests within its assigned path.

## GO / NO-GO gates

Unchecked items are required proof, not completed checks. A disabled optional feature does not block the offline P0 release; claiming or enabling it activates its gate.

- [ ] **Functional correctness — Opus/GLM:** all P0-1–P0-8 acceptance criteria completed; selected event and explicit hard/soft facts work; bounded intervention costs and no-feasible case explained; hard constraints preserved.
- [ ] **Authorization — Opus/lead/GLM:** zero unauthorized dispatches across missing, expired, revoked, cross-plan and changed-scope cases; one logical action on duplicate/retry; mock-only isolated demo boundary documented.
- [ ] **Confirmation/recovery — Opus/GLM:** no READY with pending/unknown required dependency or missing approval; cancellation immediately revokes READY; stale/conflicting callbacks cannot revive it; revised scope requires reapproval; RSVP never proves attendance.
- [ ] **Learning — lead/Opus/GLM/A:** feedback proposes exact patch; reject leaves profile unchanged; confirmation changes a later ranking explainably; hard constraints and reversibility remain intact.
- [ ] **Provenance — B/Opus/A/GLM:** independent AI/catalog/provider labels; uncertainty retained; fixture/estimated facts never called live-verified or booked; state/timeline/action evidence visible.
- [ ] **Local AI — lead:** if advertised, genuine local model on actual presentation hardware, endpoint/model identity and warm/cold timings recorded; no unsupported claim that data never leaves laptop. A stubbed HTTP response is not proof of local inference.
- [ ] **Fallback — lead/GLM/A:** unset/unreachable/slow/malformed AI still permits the entire deterministic offline P0 loop, including reviewable feedback via manual/fixture input; visible fallback status; no automatic cloud switch or external actions. Agree an explicit acceptable wait budget and test it.
- [ ] **Integration — lead/A/GLM:** canonical routes/schema/ProviderPort accepted; no missing enabled endpoints or stale profile/result pairing; fresh locked install, `npm run check`, `npm run build` pass on final merged candidate; exact logs/SHA retained.
- [ ] **Accessibility — A:** keyboard operation, focus, readable errors, pending/cancel status announcements and distinct hard/soft labels verified; source-level labels alone do not prove usability.
- [ ] **Privacy if save/share/live providers enabled — lead:** restricted plan access, minimal/redacted sharing, expiry/revocation, client-result validation, server secrets and callback authority tested. Otherwise omit/disable these extras and use fictional data.
- [ ] **Deployment controls — lead:** preserve `vercel.json` `git.deploymentEnabled: false`; inspect actual host linkage/triggers without changing them; explicit human approval before deploy; release SHA/previous known-good SHA identified; rollback compatible with any schema migration; local offline fallback available.

**GO for an isolated simulated Unlock P0 demo** only when all applicable gates above have recorded evidence on the integrated candidate; a “local AI” claim additionally requires the genuine-runtime gate. **NO-GO** if any consent, false-readiness, cancellation, preference confirmation, provenance or enabled-sharing privacy gate fails, or final integration/build verification remains unresolved.

Real messaging, booking, payments and transport operations are outside this simulated acceptance. Passing fixture tests does not approve those services. This audit made no deployment, hosting-setting change or direct push to main.
