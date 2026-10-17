# Journey: older adult, first visit

Screen ids → [SCREENS.md](../SCREENS.md).

| | |
|---|---|
| Persona | Margaret, 81, uses a walker, takes the bus or gets a ride from her son Dan. Mild hearing loss. Laptop at the senior center, or her phone. |
| Trigger | A caregiver, librarian or senior-center staffer opens DayBridge with her ("let's find you something to do this week"). |
| Goal | One outing this week she wants to go to, with a way to get there confirmed. |
| Exit | Next outing shows **Ready** on Home (U2). Target ≤ 5 min for answers + matches, ≤ 3 min more for Get me there. |

## Steps
| # | She does | Sees | Screen | Success | Failure → recovery |
|---|---|---|---|---|---|
| a | Opens the link | One sentence of what DayBridge does, "Let's start" | U1 Onboarding (intro) | Starts | — |
| b | Types her first name | "What should we call you?" | U1 | Name set | Blank → "Friend"; never blocks |
| c | Answers interest cards: Yes / No (swipe, buttons, or Easier view tiles; Hands-free only if she taps it) | One activity type per card, big Yes / No | U1 | ≥ 1 liked | Zero liked → review says "Nothing picked yet" + Change |
| d | Picks times of day | Mornings / Afternoons / Evenings | U1 | ≥ 1 | Skip → default morning + afternoon, marked "(default)" on review |
| e | Picks how far is too far | 5 plain options | U1 | One picked | — |
| f | **New:** walking aid | "Do you use anything to help you walk?" none / cane / walker / wheelchair | U1 | Asked, never inferred | Must answer; matches can't run without it |
| g | **New:** how you get places | Drive myself / Bus or train / Senior shuttle / Family or friends / Walk (pick any) | U1 | ≥ 1 | Must answer; matches can't run without it |
| h | Picks weekly budget | 4 options, "many are free" | U1 | One picked | — |
| i | **New:** reviews "Here's what we heard" | One row per answer, each with Change | U1 review | Taps **Build my week**; answers saved on this device (DS) | Change jumps to that card and back to review |
| j | Waits | Inline line "Finding activities you can get to…" in place, no spinner page | U2 Home | Week built; result + week saved (DS) | API error → "Our planner is having a moment" + Try again; answers kept |
| k | Lands on Home | "Your week": next outing, 1–3 needs-attention rows | U2 | Sees a next outing | No matches → Home says why in one line + "Change my answers" (U6) |
| l | (Optional) browses matches, adds/removes | Match cards; "didn't fit" collapsed | U3 Matches | Week has what she wants | — |
| m | Taps **Get me there** on her next outing | Coordination for that activity | U2 → X1 `/coordinate?activityId=` | Plan created; X1 saves its id (ask 2) | Hosted prod returns 503 → Home shows "Get me there isn't available on this server" (no dead link) |
| n | Approves each request (ride, invite), sees exactly what's shared | Per-request Approve, shared fields listed | X1 | All approved, sent (simulated) | Revoke any time before send |
| o | Waits for replies (demo: simulator) | "Waiting for replies" | X1 | All confirmed → **Ready** | Declined → NEEDS_REPLAN → new plan offered (see returning journey) |
| exit | Returns to Home | Next outing shows "Ready ✓"; primary becomes "See my calendar" | U2 | Done | X1 asks not shipped → Home still says Not started; READY is visible on X1 only. Server restarted → id 404s → Not started |

## NOT on screen in this journey
- Demo shortcuts on the cards (moved to the person switcher, SH).
- Raw state names (`READY`, `plan v2`), score numbers, rule ids (`activity:choir/rule:time`).
- The AI paragraph above the fold; stat chips; "Sharing: coming soon".
- Camera starting without her tap.
