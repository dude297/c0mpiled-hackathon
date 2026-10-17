# Screens

Every screen, mapped to journeys. Web first at 1440 / 1280, then 390 ([UX-GUIDE](UX-GUIDE.md)). Mobile app mapping: [MOBILE-PARITY](MOBILE-PARITY.md).

## Baseline (read first)
- Two branches, neither contains the other: `local/web-all` 62f4394 (dev server; onboarding with walking aid + transport + review) and `origin/main` 5289d17 (PRs #24/#25: `/api/intake`, `/api/plans`, `/plan/[id]`).
- **Build branch = `local/web-all` with `origin/main` merged in first.** Today web-all's `page.tsx` already calls `/api/intake` and `/api/plans`, which 404 there.
- Status column below is measured against that merge: `EXISTS` keep · `CHANGE` exists, must change · `NEW` not built · `REMOVE`. `main only` = exists on origin/main, missing on web-all until the merge.

Affordance types ([UX-GUIDE](UX-GUIDE.md#affordances)): **checkbox** (incl. toggle, multi-select tiles, disclosure) · **pull-down** (incl. radio, segmented, single-choice tiles) · **blank form** (text, textarea) · **button** · **link**. Unlisted affordance = do not add.

Journeys: N = [older adult, new](journeys/older-adult-new.md) · R = [older adult, returning](journeys/older-adult-returning.md) · C = [caregiver](journeys/caregiver.md).

## Index
| Id | Screen | Route (target) | Today | Status | Journeys | Primary action |
|---|---|---|---|---|---|---|
| DS | Device store (no UI) | all routes | React state in `page.tsx` only | NEW | all | — |
| SH | App shell header | every route | `DashboardShell` title only | NEW | all | — |
| U1 | Onboarding (cards + review) | `/welcome` | `/` mode `onboarding` (`CardDeck`) | CHANGE (minor) | N a–i | Build my week |
| U2 | Home dashboard | `/` | `/` summary card + 3 tabs | CHANGE (major) | N j–k, exit · R a–b1, exit | By state (see U2) |
| U3 | Matches | `/matches` | "Matches" tab (`MatchFeed`) | CHANGE | N l · R b3 | Add to my week |
| U4 | Calendar | `/calendar` | "My week" tab (`WeekCalendar`) | CHANGE | R b2 · C f | Open an outing |
| U5 | Activity detail | `/activity/[id]` | none | NEW | R c2 | Get me there (by status) |
| U6 | Profile (your answers) | `/profile` | "Details" tab (`ProfilePanel`, `IntakeSlot`, `EvidencePanel`) | CHANGE | R b4 · C b1 | Save (open row) |
| C1 | Caregiver dashboard | `/care` | none | NEW | C a–e | By state (see C1) |
| X1 | Get me there (coordination) | `/coordinate?activityId=[&planId=]` | `?activityId=` only | EXISTS, owned by coordination team; asks below | N m–o · R c1, d · C c | (theirs) |
| X2 | Shared plan (read-only) | `/plan/[id]` | main only | EXISTS after merge (sharing off in UI) | post-hackathon | — |
| — | "Details" tab | — | `/` tab | REMOVE: answers → U6, evidence → U5 | — | — |
| — | Tabs Matches / My week / Details | — | `/` | REMOVE: become routes U3 / U4 / U6 | — | — |
| — | "Or use the classic form" link | — | U1 footer | REMOVE: U6 is the form | — | — |
| — | "Demo: Margaret / Harold" buttons | — | U1 first card | REMOVE: moved to SH person switcher | — | — |

---

## DS Device store — NEW (client state, no UI)
Today `profile`, `result` and `added` live only in React state in `page.tsx`; a reload loses everything. Splitting into routes needs one shared client store. `src/lib/deviceStore.ts` + a client provider in `layout.tsx`, read by every screen.

| Key (`localStorage`) | Value | Written by |
|---|---|---|
| `daybridge:v1:active` | `{ person: "me" \| "margaret" \| "harold", mode: "user" \| "caregiver" }` | SH switcher, U1 finish, Start over |
| `daybridge:v1:<person>:profile` | `Profile` (zod-validated on read; invalid → dropped) | U1 finish, U6 Save, switcher (demo seed from `DEMO_PROFILES`) |
| `daybridge:v1:<person>:result` | `{ result: AnalysisResult, profileHash }` | after each `/api/analyze` |
| `daybridge:v1:<person>:week` | `activityId[]` (today's `added` Set) | U3 / U5 toggle; after analyze |
| `daybridge:v1:<person>:plans` | `{ [activityId]: planId }` | X1 (ask) on plan create / replan / alternative |

- **On load:** read `active` → profile. No profile → user routes redirect to `/welcome`; `/care` shows its empty state. Profile + result with matching `profileHash` → render at once, no API call.
- **`/api/analyze` runs only:** U1 finish · U6 Save · switching to a person with no cached result · cached `profileHash` ≠ current profile. Never on route change or reload.
- **Week after analyze:** keep ids still in `result.plan`; first analyze for a person = all plan items (today's behavior). Ids that dropped out → U2 heads-up "Choir no longer fits: entrance has stairs".
- **Handoff to X1:** `sessionStorage["daybridge:profile"]` (EXISTS) is still set before any link to X1.
- **Start over (U6):** clears the active person's keys, keeps other people → `/welcome`.
- **Storage blocked** (private window): in-memory only, one line on U2: "This browser won't remember your answers."

### Plan status (shared by U2, U4, U5, C1)
- `usePlanStatus(activityIds)`: for each id in `plans`, `GET /api/coordination/plans/:id` (no list endpoint). Re-read on page focus.
- **404** (store is in-memory on `globalThis`; a server restart kills every id) → drop the id, show Not started.
- **503** (hosted production fails closed) → hide status words; one line "Live status isn't available on this server".
- **Fallback until X1 writes `plans`:** map is always empty → every outing shows Not started, every entry opens a new plan, U2 "Fix my plan" / C1 "Open with {name}" never appear, golden step 4 is conditional ([GOALS](GOALS.md#golden-demo-path-must-stay-working)).

| `PlanState` | Word (user / caregiver) | Icon | Needs attention? | Action → X1 |
|---|---|---|---|---|
| no id / 404 / `CANCELLED` | Not started | — | no | Get me there (`?activityId=`, new plan; old id replaced) |
| `BLOCKED` | Can't go as planned | ⚠ | yes | See what's in the way (`&planId=`) |
| `PROPOSED` | Plan started, not confirmed | ○ | no | Continue my plan (`&planId=`) |
| `AWAITING_APPROVAL` | Needs your OK / Needs {name}'s OK | ○ | yes | Continue my plan (`&planId=`) |
| `PENDING_CONFIRMATION` | Waiting for replies | ◷ | no | See status (`&planId=`) |
| `READY` | Ready | ✓ | no | See plan (`&planId=`) |
| `NEEDS_REPLAN` | Needs a new plan | ⚠ | yes, first | Fix my plan (`&planId=`) |
| `COMPLETED` | Done | ✓ | no | — |

Words always with icon (never color alone). Raw state names never on screen.

## SH App shell header — NEW
Shared `layout.tsx` header, `max-w-page` frame, sticky on scroll. Also wraps X1 (integration point). `{name}` = active person's `Profile.name`.

| Affordance | Type | Why |
|---|---|---|
| "DayBridge" wordmark | link → U2 (C1 in caregiver mode) | Home anchor. |
| Home | link → U2 | Dashboard. `aria-current` on the active item. |
| Matches | link → U3 | Find more. |
| Calendar (icon **+ visible word** at ≥ 768px; icon-only with `aria-label` + tooltip below) | link → U4 | Sparsh 2026-10-17: calendar view icon in the header. Never icon-alone on desktop. |
| Profile | link → U6 | "Your answers". |
| Person switcher "{name} ▾" | pull-down | Items: You (only if onboarded on this device) · Margaret · Harold ("Demo data" once in the menu) · divider · "Caregiver view for {name}" (only when the active person has saved answers). Replaces onboarding demo buttons. Hackathon exception ([UX-GUIDE](UX-GUIDE.md#navigation)). |
| Caregiver mode header | text | wordmark · "Caring for {name}" · Care · Calendar · Profile · switcher ("Back to {name}'s view"). |

Not in header: theme toggle, Print, Share, Start over, AI badge.

## U1 Onboarding `/welcome` — CHANGE (minor)
One question per screen, "Card n of N" + progress (EXISTS). Back on every card. Shown when the active person has no saved profile.

| Card | Affordance | Type | Why |
|---|---|---|---|
| Intro | Let's start | button (primary) | One entry. |
| Name | First name | blank form | Blank → "Friend". EXISTS. |
| Interests (10 cards) | Yes / No; swipe; arrow keys | button ×2 | Swipe is a shortcut, never the only way. EXISTS. |
| | Easier view | checkbox (toggle) | Same answers as big tiles. EXISTS (relabel, drop ": on/off"). |
| | Hands-free (camera) | button, opt-in | Never auto-starts; "Camera stays on this device". EXISTS. |
| Times | Mornings / Afternoons / Evenings | checkbox (multi tiles) | EXISTS. |
| Travel | 5 distance options | pull-down (single-choice tiles) | EXISTS. |
| Walking aid | No, I walk on my own / A cane / A walker / A wheelchair | pull-down (single-choice tiles) | EXISTS on web-all 62f4394 (`WALKING_AID_OPTIONS` → `Profile.mobility`, no inference). |
| How you get places | 5 options | checkbox (multi tiles) | EXISTS on web-all 62f4394 (`TRANSPORT_OPTIONS` → `Profile.transport`). |
| Budget | 4 options | pull-down (single-choice tiles) | EXISTS. |
| Here's what we heard | Row per answer, "(default)" on defaults | text | EXISTS. |
| | Change (per row) | link (jumps to that card, returns to review) | EXISTS as outline button; it navigates, so style as link. |
| | **Build my week** | button (primary) | CHANGE: today "See my matches". Saves profile (DS), runs `/api/analyze`, goes to **U2 Home** (the label now says where it goes). Disabled with "Please answer walking aid and how you get places first." EXISTS. |
| | Hearing / small groups | checkbox ×2 in one "Optional" disclosure | NEW; default off. |

Removed: "Demo: Margaret / Harold" (→ SH), "Or use the classic form" (→ U6).

## U2 Home dashboard `/` — CHANGE (major)
Replaces summary card + tabs. Heading "Good morning, {name}". Two columns at ≥ 1280 (left: this week; right: needs attention), one column below. Reads DS + Plan status.

| Section | Content |
|---|---|
| This week at a glance | One line: `weekSummary` ("2 outings · $5 this week"). 7-day strip under it (dot + name on outing days) → U4. |
| Next outing | Name · day + time · `PlanItem.travel` · status word + icon (Plan status table). |
| Needs attention (max 3, else hidden) | Heads-up rows, amber left rule: NEEDS_REPLAN, BLOCKED, AWAITING_APPROVAL, then outings that dropped out after a re-plan, then one soft barrier ("Choir: noisy room, no hearing loop. Sit near the leader."). One link per row. |
| Matches line | "3 more good matches" → U3. |
| Why these? | Collapsed; AI explanation, labeled once inside ("Sample AI text" when `dataSource = mock`). |
| States | Building: inline "Finding activities you can get to…". Error: one line + Try again, last result kept. No matches: "Nothing fits yet: most were too far." + "Change my answers" → U6. |

Primary action (exactly one, first matching row wins):
| State | Primary |
|---|---|
| Any outing NEEDS_REPLAN | **Fix my plan** → X1 `?activityId=&planId=` |
| Any outing BLOCKED | **See what's in the way** → X1 `&planId=` |
| Next outing PROPOSED / AWAITING_APPROVAL | **Continue my plan** → X1 `&planId=` |
| Next outing PENDING_CONFIRMATION | **See status** → X1 `&planId=` (never starts a second plan) |
| Next outing Not started (incl. 404, CANCELLED, and always while the DS fallback is on) | **Get me there** → X1 `?activityId=` (golden path) |
| Everything Ready / Done | **See my calendar** → U4 |
| Week empty | **See matches** → U3 |

| Affordance | Type | Why |
|---|---|---|
| Primary (above) | button | One per screen. |
| Needs-attention row action | link | Navigates. |
| 7-day strip / matches line | link | Navigates. |
| Why these? | checkbox (disclosure) | Progressive disclosure. |
| Try again (error only) | button | Retry. |

Removed from today's summary card: [UX-GUIDE "Summary card text diet"](UX-GUIDE.md#summary-card-text-diet).

## U3 Matches `/matches` — CHANGE
Heading "Good matches for you". Cards not in the week first.

| Affordance | Type | Why |
|---|---|---|
| Match card (bordered: one object acted on) | — | Name, one plain meta line from `PlanItem` ("Wed afternoon · Bus, about 15 min · Free"; no chips), max one heads-up row with workaround; "+1 more" → U5. |
| Card title | link → U5 | Details. |
| Add to my week / In my week ✓ | checkbox (toggle, `aria-pressed`) | Writes DS `week`. Primary; full-width 56px on touch. |
| Get me there → | link (quiet) → X1 | Navigates; keeps Matches → X1 path. Shows the Plan status action word if a plan exists. |
| "6 activities didn't fit — see why" | checkbox (disclosure), collapsed | Explanation, not choice. |
| Inside: one plain row per blocked activity: name + first hard reason ("Too far: 45 min, your limit is 30") + "What would change this" | text + link → U6 | No link to U5: `AnalysisResult.blocked` has no `activityId` (schema ask below). Red icon + word "Didn't fit", no red fills. |
| Empty | "Nothing fit this week." + Change my answers | link → U6 |

Schema ask (engine owners): add `activityId` to `AnalysisResult.blocked[]`. Then the blocked name becomes a link → U5.

## U4 Calendar `/calendar` — CHANGE
From the header calendar icon. Recurring weekly, "This week" only. Source: DS `week` ∩ `result.plan` + Plan status.

| View | Content |
|---|---|
| ≥ 1024px (default) | Week grid: 7 columns × Morning / Afternoon / Evening. Block: name, status word + icon, travel mode. Today's column labeled "Today" (word). |
| < 1024px | Day list: days with outings + "Today"; each row = outing block. |
| Empty | "Nothing in your week yet." + See matches. |
| Caregiver mode | Same; status shown; add/remove hidden. |

| Affordance | Type | Why |
|---|---|---|
| Outing block | link → U5 | Primary: open an outing. |
| Week / Day | pull-down (segmented) | Overrides width default; remembered per device. |
| Print my week | button (secondary) | Moved from Home; print stylesheet exists. |
| See matches (empty) | link | Recovery. |

## U5 Activity detail `/activity/[id]` — NEW
Data: `PlanItem` from DS `result.plan` by `activityId` (when, travel, cost, barriers) + `ACTIVITIES` imported client-side by `id` (other modes from `travelMin`, `stepFree`, `noisy`, `hearingLoop`) + Plan status. No new endpoint. Not in `result.plan` → base facts only, line "Not in your matches", Get me there hidden. Unknown id → "We couldn't find that activity" + Back to matches.

| Section | Content |
|---|---|
| Header | Name, `when` ("Wed afternoon"), cost ("Free" / "$5 a week"). No place: `Activity` has no address field (addresses are code comments). Data ask: optional `place` on `Activity`; show when present. |
| Getting there | `PlanItem.travel`; other modes as one plain line. "Travel times and access are our estimates, not confirmed by the venue." once. |
| What could get in the way | Heads-up row per soft barrier: `Barrier.detail` → `mitigation`. |
| How we checked | Collapsed; passed checks as plain text. Never "Verified" (`Evidence.verified` = check passed). |
| Plan status | Word + icon + action link from the Plan status table. |

| Affordance | Type | Why |
|---|---|---|
| Primary: Plan status action (Get me there / Continue / See status / Fix my plan) | button | One primary; label from status. |
| Add to my week | checkbox (toggle) | Same as U3. |
| How we checked | checkbox (disclosure) | Progressive disclosure. |
| Back to Matches / Calendar | link | Returns where she came from. |

## U6 Profile `/profile` — CHANGE
Same rows as U1 review. One row open at a time.

| Affordance | Type | Why |
|---|---|---|
| Change (per row) | checkbox (disclosure, `aria-expanded`) | Only reveals that row's control inline; doesn't act. |
| Name | blank form | Free text. |
| Interests | checkbox (multi tiles) | Pick-many. |
| Walking aid · Travel limit · Budget | pull-down | Closed lists. |
| How you get places · Times | checkbox (multi) | Pick-many. |
| Hearing help · Prefers small groups | checkbox | Yes/no. |
| Save | button (primary, open row) | Writes DS profile, re-runs `/api/analyze`; inline "Updating your matches…"; dropped outings → U2 heads-up. |
| Describe in your own words (caregiver mode only) | blank form (textarea) in collapsed disclosure → per-row Confirm / Skip | `/api/intake` (main only; [INTAKE_CONTRACT](../daybridge/INTAKE_CONTRACT.md)). Nothing applies without Confirm. |
| Start over | button (quiet, bottom) + undo toast | Clears active person's DS keys → U1. |

## C1 Caregiver dashboard `/care` — NEW
SH in caregiver mode. Heading "{name}'s week". Shown once: "Same-device demo: no accounts are linked yet. Status is read from this browser's plans." and "Simulated rides and invites: nothing is really sent." Reads DS + Plan status for the active person.

| Section | Content |
|---|---|
| Needs fixing (only if any) | Heads-up rows: NEEDS_REPLAN ("Ride to Cards on Wednesday was cancelled. A new plan is waiting.") then BLOCKED. |
| Approvals waiting | "Waiting for {name}'s OK: ride with Dan, Wednesday afternoon". Plain rows. |
| Their week | Row per outing: day · time · name · status word + icon (Plan status table, caregiver words). |
| What was shared | Per approved action: recipient, kind, outing, `ActionScope.sharedFields` in words. Revoked: struck + "Revoked". |

Primary action (exactly one, first matching row wins):
| State | Primary |
|---|---|
| No saved profile for the active person | **Set up {name}** → U1 |
| Any NEEDS_REPLAN / BLOCKED | **Open with {name}** → X1 `&planId=` (first row) |
| Any AWAITING_APPROVAL / PROPOSED | **Open with {name}** → X1 `&planId=` (first row; caregiver doesn't approve, GOALS Open) |
| Week empty | **Pick activities with {name}** → switches to user mode → U3 |
| Status unavailable (503) or everything Ready / waiting / Not started | **See {name}'s calendar** → U4 |

| Affordance | Type | Why |
|---|---|---|
| Primary (above) | button | One per screen. |
| Other row actions | link → X1 / U5 | Navigate. |

## X1 Get me there `/coordinate` — EXISTS (coordination team; integration only)
- Entry: `?activityId=` (new plan) or `?activityId=&planId=` (resume) from U2, U3, U5, C1. Profile via `sessionStorage["daybridge:profile"]` (EXISTS).
- **Ask 1, resume:** accept `?planId=` → `GET /api/coordination/plans/:id` and render it. 404 → create a new plan from `activityId` and replace the id. Today it always POSTs a new plan.
- **Ask 2, record:** after create / replan / `choose_alternative`, write `daybridge:v1:<person>:plans[activityId] = planId` (read `daybridge:v1:active` for person).
- Without asks 1–2: DS fallback applies (all Not started; no resume).
- Wrap in SH; "← Back to home" link. Hide raw `READY` / `plan v2` behind a details disclosure; one "Simulated" label; "Get them there" only in caregiver mode; simulator labeled "Demo".
- Demo contacts (Dan, son) are hard-coded on X1 for every person; fine for the demo, not a per-person promise.

## X2 Shared plan `/plan/[id]` — main only, EXISTS after merge
- Read-only redacted snapshot ([SHARE_CONTRACT](../daybridge/SHARE_CONTRACT.md)). UI entry hidden while `SHARE_AVAILABLE = false`; when on, "Share my week" in U4 next to Print. Never a disabled "coming soon" button.
