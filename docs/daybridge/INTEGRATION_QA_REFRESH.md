# Independent integration QA — PR #3 refresh

2026-10-17. This supersedes PR #4's statement that no coordination implementation/contract was available. **Reviewed application core: `c76fa70d7380b356aad5a2aca170619215cafea1`; final operations base: main `22b4929b2c43ba6f043cad444a3320edf52769ee`.** Another actor merged #1, revised #3 and #4 during this audit; Work did not perform those merges. The later base adds audit/decision/persistence-proposal docs and raises an existing fuzz-test timeout, with no business-logic change. Mock coordination exists on main; UI, durable state, authentication and live providers remain release limitations.

Initial reviewed PRs: [#1](https://github.com/dude297/c0mpiled-hackathon/pull/1) at `ad75ab07a48d53726836c8d96264d65eb9cb2f3a`, [#2](https://github.com/dude297/c0mpiled-hackathon/pull/2) at `c2bafd5841739774ba2ace0debb30fac88111789`, [#3](https://github.com/dude297/c0mpiled-hackathon/pull/3) initially at `b35a4fb4a783d79f2cdb65ae1e5a189c017759a4`, [#4](https://github.com/dude297/c0mpiled-hackathon/pull/4) at `6e5317842a5f313b95edf30e3dd8c716ee0e069e`. At publication, #1/#3 were merged; open queue was #2, #4, new [#7](https://github.com/dude297/c0mpiled-hackathon/pull/7) (`106b0f73568678af8e14e9e5f367c9509e2671c3`) and this operations PR #8. Reviewed the revised #3 (`f6b1236`, fixes `41e3da0`, contract `c61b595`), PR #7 source/description and main's `PR_ORCHESTRATION.md`. Later commits remain outside this pinned assessment.

At final handoff #4 was also merged. Its old branch's post-merge notices would not alter main, so this operations PR directly adds supersession notices to the three merged audit documents as well. Reviewed `DECISIONS.md`, `INTEGRATION_STATUS.md` and `PERSISTENCE_AUTH_PROPOSAL.md` from `22b4929`. Preserve the distinction between Opus's integration-branch test claims and Work's independently executed/pinned results below.

## Corrected implementation assessment

Merged PR #3 implements a deterministic mock-provider backend: versioned coordination schemas; proposal/approval/pending/READY/replan/complete/cancel states; scope/expiry/revocation checks; idempotent provider events and dispatch keys; cancellation invalidation; alternative/recovery proposals; confirmed preference patches; event timeline API. It resolves the `/api/plans` collision by using `/api/coordination/**`. GLM has now published real-coordinator Phase 2 tests in #7; that branch was based on the earlier `b35a4fb` engine, so it needs review/rebase against the fixed main. No UI/catalog/AI code was changed by #3.

Independent verification: original PR #3 `b35a4fb` snapshot check passed (4 files / 39 tests). After refresh onto merged `c76fa70`, **`npm run check` passed with 5 files / 140 tests**, typecheck/lint passed, and **`npm run build` passed**, including all four dynamic coordination routes. The 19 monitoring Node tests also passed separately. These executed results supersede #4's earlier baseline environment/build failure and the need to rely solely on the coordinator author's build claim. A future UI/provider/GLM combined candidate still needs its own exact-SHA verification; no HTTP/browser or genuine local-model run is certified here.

Also executed PR #7's actual `coordination-sim.test.ts` unchanged against isolated merged `c76fa70` source: **1 file / 18 tests passed**, Vitest 4.44s, no network. Its old-head F2 report is not evidence of a current main defect. Phase 1's copied-planner criticism remains independent of these real-coordinator tests.

| P0 | Historical main (26b9762) | Merged coordinator (c76fa70) | Remaining acceptance |
|---|---|---|---|
| 1 Profile/constraints | PARTIAL | PARTIAL; contacts added to create request, legacy profile preserved | UI contact/constraint editing and hard/soft labels; day/date/unknown semantics |
| 2 Selected-event barriers | PARTIAL | PARTIAL; selected `activityId` runs real `checkActivity` | UI selection, factual provenance/unknown access, broader hard facts |
| 3 Minimum intervention | PARTIAL | PARTIAL; ride/invite/user-step proposals and alternatives | Explicit burden/cost comparison absent; first candidate preference is not ranked minimum-intervention proof; no ride fare |
| 4 Consent/invite/RSVP | MISSING | PARTIAL at product level; activity-scoped mock core exists | UI, actual actor ownership and future payload/cost binding; do not call mock dispatch a real send |
| 5 Transport | PARTIAL | Backend mock option/request/confirm/decline/cancel now implemented | UI proof and transport provenance; live adapter not required for simulated P0 |
| 6 Replan | MISSING | Backend cancellation revokes READY and generates recovery/alternatives; activity carry-over fix merged | Review GLM replay on fixed main, UI revised-proposal/reapproval |
| 7 Feedback | MISSING | PARTIAL; structured signals propose patches; confirm changes profile/version | Natural-language extraction absent, review UI, persistence/reversal and full learning loop integration |
| 8 Observability | PARTIAL | PARTIAL; GET timeline and command event deltas exist | UI state/actions/timeline/before-after integration |

Do not retain “0 backend mechanisms implemented” as the current assessment. Also do not count merged #3 as a completed end-to-end Unlock release. **NO-GO for integrated P0 or public hosted release** until the applicable gates below pass.

## Remaining findings with evidence

Historical links are pinned to the original PR #3 SHA; closure/current-code links explicitly use merged `c76fa70`.

| Priority / owner | Finding | Evidence / closure request |
|---|---|---|
| P0 integration — A + Opus | Coordinator is not wired into frontend | PR changes no UI. `src/app/page.tsx` still calls analyze only on main. A must consume command `outcome`/`reason` even on HTTP 200 rejected, expose approvals/confirmations/replan/feedback and label simulated providers. |
| CLOSED for activity switch — Opus + GLM | Historical cross-activity confirmation carry-over reproduced, then fixed | Original [`sameScope`/carry-over](https://github.com/dude297/c0mpiled-hackathon/blob/b35a4fb4a783d79f2cdb65ae1e5a189c017759a4/src/domain/coordination/coordinator.ts#L39-L136) lacked activity identity. Merged [`sameScope`](https://github.com/dude297/c0mpiled-hackathon/blob/c76fa70d7380b356aad5a2aca170619215cafea1/src/domain/coordination/coordinator.ts#L42-L45) binds `activityId`; independent probe now passes: old invitation superseded and new activity requires fresh approval. Future live adapter scope still needs exact payload/location/cost review. |
| Hosted release blocker — lead | Process-memory state and locks are not durable or shared | [`_lib/service.ts:5–9`](https://github.com/dude297/c0mpiled-hackathon/blob/b35a4fb4a783d79f2cdb65ae1e5a189c017759a4/src/app/api/coordination/_lib/service.ts#L5-L9); coordinator owns in-process Map/lock. Restart/multi-instance loses/diverges plans, approvals and idempotency. Lead selects durable transaction/replay semantics before hosting; a local single-process fixture demo can explicitly accept this limit. |
| Proposal review — lead + Opus | Persistence/auth proposal is not an implementation; its optional fallbacks need tightening | [`PERSISTENCE_AUTH_PROPOSAL.md`](https://github.com/dude297/c0mpiled-hackathon/blob/22b4929b2c43ba6f043cad444a3320edf52769ee/docs/daybridge/PERSISTENCE_AUTH_PROPOSAL.md) explicitly remains proposed. Reject the non-atomic update-then-log fallback for authoritative state; uniqueness does not roll back a partially written plan. Hosted auth/store failure must fail closed rather than silently switching to unauthenticated memory. Require transactional revision/log/key updates plus proven provider idempotency/outbox semantics before concurrent live dispatch. No deployed flaw or applied migration is claimed. |
| Hosted release blocker — lead + Opus | No authentication/plan owner authorization | Commands/GET trust possession of id; approvals record literal `approvedBy: user`, not authenticated identity. Production disable of demo events does not protect command/read endpoints. Add ownership enforcement before public/multi-user use. Do not interpret disabled callback route as full security. |
| External integration boundary — B + lead | Only mock provider exists | [`provider.ts`](https://github.com/dude297/c0mpiled-hackathon/blob/b35a4fb4a783d79f2cdb65ae1e5a189c017759a4/src/domain/coordination/provider.ts) has a pure in-memory idempotent mock. No real invitations/rides, callback authentication or cancellation delivery. `cancel` records `dispatchedActionsToNotify`, not external notifications. Live adapters are optional but must remain disabled/unclaimed until proven. |
| P0 completeness — Opus + lead | Scope/budget and feedback are narrower than spec | ActionScope now includes activity identity but no actual payload hash/location/cost limit. Planner picks first driving contact then paratransit and compares soft counts, without monetary intervention costs. Feedback maps four structured signals to fixed patches; no free-text model extraction/reversal. Preserve explicit P0 exceptions or implement acceptance. |
| Independent verification — GLM | #7 now tests actual coordinator; #2 copied-planner concern remains | #7 injects ProviderPort/clock into real `createCoordinator`, with 18 tests and schema/negative-state assertions. Its PR description's F2 key-burning finding is stale: main now reserves keys only after request/kind validation. Rebase #7 without reverting coordinator changes and refresh its findings. Keep cross-activity and provider-delay expiry regressions. |

Additional review requests: execute prechecks approval expiry once before awaiting all sequential dispatches; a slow first provider may cross a later action's expiry before send. The mock's stable idempotency key is useful, but retry safety of a future real provider must be proven, not assumed. `readyViolations` is a diagnostic helper, not authenticated authority or a complete validation of arbitrary client-provided plans. Contacts' `canDrive` remains trusted input, not a provider confirmation.

## Historical reproduction and verified closure

Executed an independent scratch probe against unchanged PR #3 modules, injecting synthetic catalog/provider/clock; exit 0. No application code edited, no network or real recipient.

1. Two distinct synthetic garden activities have the same Monday afternoon slot and both require a ride plus companion.
2. Create the first activity with a friend and a separate driving contact; accept, approve all actions, execute, then confirm ride and invite. State becomes READY.
3. Cancel the ride. State becomes NEEDS_REPLAN; confirmed friend's invitation is retained.
4. Choose the second activity. The old invitation action remains `dispatched` and dependency remains `confirmed`, despite the changed activity name; no new invitation or approval is required for that carried action.

Historical output: `confirmed invite for Original Garden carried to Different Garden without new invitation/approval; same weekday/slot and shared field names`. Repeated against merged `c76fa70`, the independent assertion now passes: `old invite superseded; Different Garden requires a new activity-scoped invitation approval`. This specific defect is closed in the reviewed main. No one was contacted; no coordinator source was edited by Work. GLM should retain an independent regression.

## Immediate integration/release gate

- Opus: retain verified activity-scoped consent fix, review future payload/cost semantics, orchestrate candidate assembly and API-owner reviews.
- GLM: independent actual-code tests and event replay, including false READY, duplicate/out-of-order, cancellation and stale consent; no copied planner as proof.
- A: wire complete UI flow and verify pending/cancelled/rejected states accessibly, without saving stale profile/result pairs.
- B: verified activity provenance and one truthful external handoff if in agreed scope; preserve uncertainty and simulated provider labeling.
- Lead: local model/fallback evidence; single-process-only demo decision vs durable/authenticated hosted architecture; privacy-safe share design; exact candidate checks/build and release approval.
- Work: independently reassess the final combined SHA. Monitoring readiness is not product release readiness. No deploy/merge/business-logic change was made by this review.
