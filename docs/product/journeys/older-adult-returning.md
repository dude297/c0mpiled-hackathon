# Journey: older adult, returning

Screen ids → [SCREENS.md](../SCREENS.md).

| | |
|---|---|
| Persona | Margaret, already onboarded, has 1–3 outings in her week. |
| Trigger | (a) a ride/invite changed (NEEDS_REPLAN); (b) checking what's on this week; (c) wants something new; (d) her situation changed (new walker, no more bus). |
| Goal | Know what's next and that it's still on; fix anything broken. |
| Exit | Every outing this week is Ready or knowingly not needed. Target ≤ 2 min. |

## Steps
| # | She does | Sees | Screen | Success | Failure → recovery |
|---|---|---|---|---|---|
| a | Opens DayBridge | Lands on Home, never on onboarding | U2 Home | — | No saved answers on this device → U1 |
| b1 | Trigger (a): sees heads-up row "Your ride to Cards on Wednesday was cancelled. We have a new plan." | Amber-rule row, primary "Fix my plan" | U2 | Opens the plan | — |
| c1 | Reviews new plan, approves the new ride; already-confirmed friend is **not** asked again | Coordination recovery | X1 `/coordinate` | Back to Ready | No ride left → "Can't go this week" + alternatives (choose one) or Cancel plan |
| b2 | Trigger (b): taps **Calendar** icon in header | Week grid, each outing with status + time | U4 Calendar | Knows the week | Empty week → "Nothing in your week yet" + "See matches" |
| c2 | Taps an outing | Details: where, when, how she gets there, what could get in the way | U5 Activity detail | — | — |
| b3 | Trigger (c): Matches | Cards not yet in her week first | U3 | Adds one, then Get me there | Nothing new fits → open "didn't fit" to see why → U6 to change |
| b4 | Trigger (d): Profile → Change "Walking aid" | Answers as rows, one inline edit | U6 Profile | Saved → matches + week re-plan in place | Re-plan removes an outing that no longer fits → heads-up on Home "Choir no longer fits: entrance has stairs" |
| d | After an outing: "How did it go?" (Went / Didn't go; Enjoyed / Too crowded / Too far / Too expensive) | On X1 when plan READY and the day has passed | X1 | Feedback saved; preference change only after she confirms | — |
| exit | Home shows everything Ready | | U2 | | |

## NOT on screen
- Re-running onboarding to change one answer.
- Any change to her answers that she did not confirm (AI suggestions included).
