# Journey: caregiver

Screen ids → [SCREENS.md](../SCREENS.md).

| | |
|---|---|
| Persona | Dan, Margaret's son (the demo contact `dan` in `/coordinate`, canDrive). Demo story uses Margaret; screens say `{name}` = the active person (Harold or a newly onboarded person works the same). |
| Trigger | (a) setting Margaret up for the first time; (b) a weekly check "is mom's week OK?"; (c) a ride was cancelled. |
| Goal | See Margaret's week, know each outing is Ready, fix or flag what isn't, see what was shared. |
| Exit | Nothing needs attention, or Dan has opened the fix with Margaret. Target ≤ 1 min for a check. |
| Honesty | **No account linking yet.** Caregiver view is a switch on the same browser, reading that browser's saved answers and plan ids, labeled once on C1: "Same-device demo: no accounts are linked yet. Status is read from this browser's plans." |

## Steps
| # | Dan does | Sees | Screen | Success | Failure → recovery |
|---|---|---|---|---|---|
| a | Person switcher → "Caregiver view for Margaret" | Header "Caring for Margaret"; nav: Care · Calendar · Profile | SH → C1 `/care` | In caregiver view | Item hidden when the active person has no saved answers; reached anyway → primary "Set up {name}" → U1 |
| b1 | Trigger (a): describes Margaret in his own words (optional) | Suggested answers, each must be confirmed | U6 Profile (caregiver view, "Describe in your own words") | Confirmed answers → re-plan | Unclear text → fields left unset, never guessed |
| b2 | Trigger (b): reads "Margaret's week" | Each outing: day, time, name, status word (full list: [SCREENS Plan status](../SCREENS.md#plan-status-shared-by-u2-u4-u5-c1)) | C1 | All Ready → primary "See Margaret's calendar" | Status unavailable (503) → one line, primary "See Margaret's calendar". X1 asks not shipped → everything Not started |
| c | Trigger (c): sees "Needs a new plan" row at top | Amber-rule row: what changed + primary "Open with Margaret" | C1 → X1 `/coordinate?activityId=&planId=` (resumes) | Recovery accepted (by Margaret) → Ready | No ride left → alternatives listed on X1 |
| d | Checks approvals waiting | "Waiting for Margaret's OK: ride with Dan, Wed afternoon" | C1 | Knows what's pending | Caregiver cannot approve for her (default; see GOALS Open) |
| e | Checks what was shared | Per approved request: who, which fields (name, pickup window, mobility), for which outing | C1 "What was shared" | Trust | — |
| f | Opens Calendar | Same calendar as Margaret, read-only for status | U4 | — | — |
| exit | Switches back to Margaret | Person switcher | SH | | |

## NOT on screen
- Editing Margaret's answers silently (every edit is confirmed and visible on Margaret's Profile as "Changed by Dan" [post-hackathon]).
- Margaret's AI explanation text, scores, raw event log.
- Any claim that Dan is notified (no notifications in MVP).
