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
| G3 | When something breaks (ride cancelled), the person and caregiver see it and fix it in ≤ 2 taps | Trust; READY is never stale |
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
| Onboarding cards (existing) + walking aid + how you get places + "Here's what we heard" review | Free-text-only onboarding |
| User Home dashboard, Matches, Calendar (week; day list on phone), Activity detail, Profile | Search, map view |
| `/coordinate` as is (owned by coordination team), linked from Home, Matches, Calendar, Activity detail | Coordination redesign |
| Caregiver dashboard `/care` (same-device demo) | Linked caregiver accounts, multi-person caseload |
| Demo people Margaret + Harold, in the person switcher | Demo shortcuts on onboarding cards |
| Web first (1440 / 1280), then 390; Expo app with the same journeys | Native-only features (widgets, watch) |

## Golden demo path (must stay working)
1. `/` → onboarding (or switch to Margaret) → Home shows next outing.
2. Home "Get me there" → `/coordinate?activityId=…` → approve ride + invite → simulate confirmations → READY.
3. Simulate ride cancelled → NEEDS_REPLAN → accept new plan → READY.
4. Switch to "Caregiver view" → `/care` shows the same outing READY (or NEEDS_REPLAN before step 3 is fixed) and what was shared.

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
