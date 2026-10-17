# DayBridge: Roadmap Status (reconciliation)

**Baseline:** `origin/main` at `5289d17` (Merge PR #25), checked 2026-10-17. The original roadmap is `docs/daybridge/PRODUCT_ENGINEERING_SPEC.md` §3 (P0/P1/P2) and §13 (post-hackathon roadmap).

**Status rules:**
- **IMPLEMENTED:** merged to `main` and reachable in the running app (or via its API, where the row says "backend").
- **PARTIAL:** some of it is on `main`, but a named piece is missing or not wired up.
- **MISSING:** not on `main`. Work may exist on an **unmerged** branch or PR, and that is listed as evidence, but **unmerged work is never counted as IMPLEMENTED**.
- **DEFERRED:** out of scope by an explicit decision (spec §3.3 P2, or a guarded "experiment" PR).

## Summary table

| Roadmap item | Status | Evidence on `main` | Unmerged work |
|---|---|---|---|
| Intake confirmation UI and safe onboarding | **PARTIAL** | Backend: `POST /api/intake` suggests a profile and never runs the planner (`src/app/api/intake/route.ts:5`). `confirmedFields: []` is always empty (`src/lib/ai/intake/intake.ts:6,68`). Tests: `src/lib/ai/intake/intake.test.ts`. UI: `IntakeSlot` is hard-disabled (`src/components/dashboard/panels.tsx:322`, `available = false`). `src/app/page.tsx:45-55` would apply the suggested profile and run the planner **with no confirm step** if the slot were enabled | `cand/intake-ui` (local only, no commits beyond main, not pushed). PR #12 `ui/swipe-onboarding` (open): swipe/Connections-style onboarding (`src/components/onboarding/CardDeck.tsx`). Doesn't wire intake confirmation |
| Sharing consent/UI and durable snapshots | **PARTIAL** | Backend: `POST /api/plans` creates a consented, redacted, read-only, expiring, revocable snapshot (`src/app/api/plans/route.ts`, `src/lib/share/share.ts`, `docs/daybridge/SHARE_CONTRACT.md`). Read page: `src/app/plan/[id]/page.tsx`. **UI not wired:** `savePlan` sends `{profile, result}` with no `consent` (`src/app/page.tsx:57-66`). The API rejects that, and the panel shows "Saving isn't available yet" (`panels.tsx:243`). **Not durable:** in-memory `globalThis` map (`share.ts:95-96`), and `shareStoreAvailable()` returns false in production unless `SHARE_STORE=memory` (`share.ts:101-103`) | `cand/share-ui` (local only, no commits beyond main, not pushed). Durable storage depends on PR #23 |
| Hosted authentication and persistence | **DEFERRED** (guarded experiment) | Hosted production fails closed: coordination returns 503 unless `DAYBRIDGE_DEMO_EVENTS=1` (`src/app/api/coordination/_lib/service.ts:11,18`, PR #22 merged). No auth and no DB on main. Proposal only: `docs/daybridge/PERSISTENCE_AUTH_PROPOSAL.md` | PR #23 `experiment/daybridge-cloud` (OPEN, **CONFLICTING**, titled "do not merge without approval"). It adds Supabase store/auth (`src/lib/supabase/*`, `src/domain/coordination/store.ts`, `src/app/cloud/page.tsx`) |
| Natural-language feedback and reversible preference history | **PARTIAL** | Feedback is **structured signals, not natural language**: `FeedbackSignal = enjoyed / too_crowded / too_far / too_expensive` (`src/lib/schema.ts:161`), and the buttons are at `src/app/coordinate/page.tsx:428-433`. Patches are proposed and applied only after `confirm_preference` (`coordinator.ts:356-377`, `planner.ts:96-107`). There are 3 fields (`schema.ts:150`). A `preference.updated` event carries `from/to/profileVersion` (`coordinator.ts:377`). **No undo/revert command** and no per-person preference history: patches are scoped to the plan's profile copy (also noted in `INTEGRATION_STATUS.md:38`) | none |
| Date-specific availability and activity freshness | **MISSING** | Availability is weekday + time-of-day only: `Activity.day: "Mon".."Sun"`, `time` slot (`src/domain/activities.ts:7-20`), and `Profile.times` (`schema.ts:16`). No calendar dates, no exceptions, no `lastVerified`/`fetchedAt` on activities. The catalog is a static October 2026 snapshot (`activities.ts:22-25`) | PR #11 `intg/third-party` (OPEN, mergeable): dated public events with past-event filtering (`src/lib/integrations/events.ts:24-39`), live route `src/app/api/integrations/events/live/route.ts`, calendar helper `src/lib/integrations/calendar.ts` |
| Venue/accessibility provenance and genuine provider confirmations | **PARTIAL** | Provenance: accessibility fields marked "est." are documented as not venue-verified (`activities.ts:22-25`). Engine evidence has `source` and `verified` (`engine.ts:104-108`), but `verified` means "rule passed", not "venue confirmed". Confirmations: `requested → confirmed` only happens through a provider event (`INTEGRATION_STATUS.md:36`). The only provider is an offline **mock** (`src/domain/coordination/provider.ts:13-28`, `dataSource: "mock"`). **No genuine provider confirmations** | PR #11: Google Places accessibility, labelled "unconfirmed by the venue", never verified (`src/lib/integrations/places.ts:129-135`). A rideshare adapter (`src/lib/integrations/rideshare.ts`) is still not a real confirmation. PR #18 `feat/coord-demo-narrative` (OPEN, CONFLICTING): narrative never calls `requested` confirmed (`narrative.ts:4-5`) |
| Small-group coordination and intervention-cost explanations | **PARTIAL** | Single invite only: the planner picks the **first** available contact for a social barrier (`planner.ts:64-69`), and the first ride candidate (`planner.ts:57`). Interventions are listed with descriptions in the UI (`coordinate/page.tsx:285-314`). **No weighted intervention-cost** (spec §7 `cost(i)`). Ranking uses the engine score `10·matches − 2·soft − travel/10` (`engine.ts:75`), and P0-3 is still PARTIAL (`INTEGRATION_STATUS.md:34`). Multi-person groups: none | none |

## Caregiver extension (new, not in original roadmap)

The original spec explicitly deferred "complex caregiver permission trees" (§3.3 P2). The caregiver dashboard is a **new** extension, scoped by the frozen backend spec v1 (grants view/checkin/manage, check-ins, attention, history). It is not a roadmap item being completed.

| Item | Status | Evidence |
|---|---|---|
| Caregiver dashboard backend (`/api/caregiver/**`, `src/domain/caregiver/**`) | **MISSING** on main | Nothing under `src/app/api/caregiver` or `src/domain/caregiver` on `origin/main`. Branch `feat/caregiver-backend`: see the contract doc's Status column for what's verified on the branch |
| Caregiver dashboard frontend (`src/app/caregiver/**`, `src/components/caregiver/**`) | **MISSING** | No caregiver pages on main. Handoff written: `docs/handoffs/caregiver-dashboard-ui.md` |
| Contract | Documented (PROPOSED unless marked) | `docs/daybridge/CAREGIVER_DASHBOARD_CONTRACT.md` |

## Notes
- The merged P0 core is the coordination engine (`src/domain/coordination/*`): consent-gated actions, the READY invariant and recovery. It is outside this table's scope, and its assessment is in `INTEGRATION_STATUS.md:29-39`.
- PR #21 (open, docs only) records final-sprint decisions and guarded features. It doesn't change any status above.
- Re-run this reconciliation after any of #11, #12, #18 or #23, or after `cand/*` or `feat/caregiver-backend` merges.
