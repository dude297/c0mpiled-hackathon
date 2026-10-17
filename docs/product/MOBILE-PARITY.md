# Mobile parity (Expo)

App: `c0mpiled-mobile/mobile` (expo-router). Today: onboarding (`app/onboarding.tsx`, already asks walking aid + transport + review) and tabs **Matches · My week · Details** (`app/(tabs)/`). Rule: same journeys, same primary action per screen, native idioms. Web is designed first ([UX-GUIDE](UX-GUIDE.md#web-first-then-390-then-expo)).

## Screen map
| Web | Expo | Status | What differs and why |
|---|---|---|---|
| SH header nav | Bottom tab bar: **Home · Matches · Calendar · Profile** (icons + labels, 64px items) | CHANGE (add Home, rename My week → Calendar, Details → Profile) | Tabs are the native idiom; calendar is a tab, not a header icon. |
| SH person switcher | Profile tab top row "{name} ▾" → action sheet (You / Margaret / Harold / Caregiver view for {name}) | NEW | Action sheet is native single choice; keeps tab bar to 4. |
| U1 Onboarding | `onboarding.tsx` stack | EXISTS | Swipe deck is native; Hands-free opt-in only (same camera rule). |
| U2 Home | `(tabs)/index` | NEW | No coordination status in MVP (see below), so primary is "Get me there" / "See my calendar" / "See matches" only. Sticky bottom bar above tabs. |
| U3 Matches | `(tabs)/matches` | CHANGE | "Didn't fit" collapsed; heads-up rows with amber left rule (no fill); add "Get me there". |
| U4 Calendar | `(tabs)/calendar` (was `week`) | CHANGE | Day list only (no grid at phone width); swipe left/right between days; badge = outings this week (EXISTS). |
| U5 Activity detail | Stack screen `activity/[id]` pushed from Matches/Calendar/Home | NEW | Back gesture (iOS edge swipe / Android back). Sticky "Get me there". |
| U6 Profile | `(tabs)/profile` (was `details`) | CHANGE | Edit row opens a bottom sheet, not inline. |
| C1 Caregiver | Caregiver mode swaps tabs to **Care · Calendar · Profile** | NEW | "Caring for {name}". Same-device label once. Shows the week without status: one line "Plan status shows in the web app for now." Primary "See {name}'s calendar". |
| X1 `/coordinate` | Opens the web route in an in-app browser (`expo-web-browser`), always `?activityId=` (new plan) | NEW link | No native coordination screen for the hackathon. [SPARSH TO DECIDE: native X1 later?] Mock providers + hosted 503 behave the same. |
| X2 `/plan/[id]` | Native share sheet with the link (when sharing is on) | later | — |

## State and coordination status on Expo
- Device store: same shape and keys as web [DS](SCREENS.md#ds-device-store--new-client-state-no-ui), kept in memory for the MVP (the app has no AsyncStorage dependency). Relaunch = onboarding or demo person again.
- **No coordination status in the Expo MVP.** X1 runs in `expo-web-browser`, whose storage is separate from the app, so the app never sees plan ids. Home / Calendar / Care show no status words; "Get me there" always opens a new plan.
- Post-MVP: open X1 with `WebBrowser.openAuthSessionAsync(url, "daybridge://plan")`; X1 redirects to `daybridge://plan?activityId=…&planId=…` after create / replan; the app saves the id and reads `GET /api/coordination/plans/:id` like web (same 404 / 503 rules).

## Gestures and native idioms
| Gesture | Where | Fallback (always present) |
|---|---|---|
| Swipe card left/right | U1 interests | No / Yes buttons |
| Head tilt / gaze (Hands-free) | U1, opt-in | Buttons; camera off by default |
| Pull to refresh | Matches (re-run analyze after an answer change) | Re-runs on Profile save anyway |
| Swipe between days | Calendar | Day chips at top |
| Edge swipe back | Activity detail | Back button in header |
| Haptic tick | Add to my week, Approve | Visual ✓ + word |

## Same rules on mobile
- Body ≥ 17px (use 18), targets ≥ 56px, sentence case, no uppercase eyebrows, one tinted surface max, heads-up = amber left rule.
- Respect system font scaling (Dynamic Type / Android font size) up to 200% without clipping; never `allowFontScaling={false}`.
- Truth labels identical in wording and count to web.
