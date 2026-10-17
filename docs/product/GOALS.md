# DayBridge: goals, non-goals, MVP scope

Product source: [docs/daybridge/README.md](../daybridge/README.md), [PRODUCT_ENGINEERING_SPEC](../daybridge/PRODUCT_ENGINEERING_SPEC.md), [COORDINATION_CONTRACT](../daybridge/COORDINATION_CONTRACT.md). This folder is the UX layer on top: [journeys/](journeys/) → [SCREENS](SCREENS.md) → [UX-GUIDE](UX-GUIDE.md) → [MOBILE-PARITY](MOBILE-PARITY.md).

## What it is
- Helps an older adult find social activities they will enjoy **and can actually get to**, then gets them there.
- Deterministic planner (`src/domain/engine.ts`) checks time, access, travel, cost, hearing, group size against real Berkeley activities.
- "Get me there" (`/coordinate`) coordinates rides and invites, but only with the person's explicit, scoped OK. Simulated providers only.
- A caregiver can see the person's week and what needs fixing.

## Goals
| # | Goal | Why |
|---|---|---|
| G1 | A first-time older adult gets a week of real activities they can attend in one short sitting | Core value |
| G2 | From any outing, one tap starts "Get me there" and reaches READY with consent | The differentiator: we get them there, not just list events |
| G3 | When something breaks (ride cancelled), the person and caregiver see it and fix it in ≤ 2 taps | Trust; READY is never stale. Needs X1 resume + saved plan ids |
| G4 | Nothing is sent or shared without a specific approval; shared fields are always visible | Consent is the product |
| G5 | Usable by an 80-year-old: large type, few choices per screen, one primary action | Audience |
| G6 | Feels like a full web app: shell header, Home dashboard, Matches, Calendar, Profile, Caregiver view | Sparsh 2026-10-17 ("doesn't feel like a full webapp build") |

## Non-goals (hackathon)
- Real accounts, sign-in, or caregiver ↔ person account linking (caregiver view is a same-device switch, labeled).
- Real messages, bookings, payments (mock providers only; already enforced in code).
- Group negotiation / marketplace ("DayBridge Collective"), groceries, medication, voice concierge.
- Multi-week calendars, recurring-exception editing, reminders/push.
- Activities outside the 15 curated Berkeley listings in `src/domain/activities.ts`.
- Showing the AI as a decision-maker. The AI only explains; it never approves, confirms or changes state.

## MVP scope
| In | Out (post-hackathon) |
|---|---|
| Personas: older adult (new, returning), caregiver | Activity organizer, ride provider screens |
| App shell header: brand · Home · Matches · Calendar icon · Profile · person switcher (incl. "Caregiver view") | Notifications center |
| Onboarding cards + walking aid + how you get places + "Here's what we heard" review (all on web-all 62f4394) | Free-text-only onboarding |
| Device store: answers, last result, week, plan ids saved per person in this browser ([SCREENS DS](SCREENS.md#ds-device-store--new-client-state-no-ui)) | Server-side accounts / sync across devices |
| User Home dashboard, Matches, Calendar (week; day list on phone), Activity detail, Profile | Search, map view |
| `/coordinate` (owned by coordination team), linked from Home, Matches, Calendar, Activity detail; asks: resume by `?planId=` + save plan ids on the device | Coordination redesign |
| Caregiver dashboard `/care` (same-device demo) | Linked caregiver accounts, multi-person caseload |
| Demo people Margaret + Harold, in the person switcher | Demo shortcuts on onboarding cards |
| Web first (1440 / 1280), then 390; Expo app with the same journeys | Native-only features (widgets, watch) |

## Prerequisite
- Build branch = `local/web-all` with `origin/main` merged in. Without it `/api/intake`, `/api/plans` and `/plan/[id]` 404 ([SCREENS Baseline](SCREENS.md#baseline-read-first)).

## Golden demo path (must stay working)
1. `/` → onboarding "Build my week" (or switcher → Margaret) → Home shows next outing.
2. Home "Get me there" → `/coordinate?activityId=…` → approve ride + invite → simulate confirmations → READY.
3. Simulate ride cancelled → NEEDS_REPLAN → accept new plan → READY. (All on X1; works today.)
4. **Conditional on X1 asks 1–2** (resume by `?planId=`, save plan ids): back on Home the outing shows Ready; switch to "Caregiver view for Margaret" → `/care` shows it Ready (or "Needs a new plan" + "Open with Margaret" if shown before step 3) and what was shared.
   - Not shipped → skip step 4's status claims: `/care` shows the week as Not started; demo the cancel/replan story on X1 only.
   - Don't restart the dev server between steps: plan ids die with it (404 → Not started).

## Judging-day success
| Check | Target |
|---|---|
| Golden path, cold start to READY | ≤ 3 minutes, no dead ends, no console errors |
| Every screen | One primary action; body text ≥ 17px; targets ≥ 44px |
| Truth labels | "Simulated", "Demo data", "Sample AI text", "estimated" each shown once where they apply |
| Mobile | Same journeys on Expo; nothing broken at 390px web |

## Open
- [SPARSH TO DECIDE: can a caregiver approve a ride/invite on the person's behalf? Default here: no, caregiver sees it and opens `/coordinate` with the person.]
- [SPARSH TO DECIDE: keep Hands-free (camera) on the judged demo path? Default: opt-in only, never auto-start.]
