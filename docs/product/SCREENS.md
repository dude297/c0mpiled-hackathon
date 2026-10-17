# Screens

Every screen, mapped to journeys. Web first at 1440 / 1280, then 390 ([UX-GUIDE](UX-GUIDE.md)). Mobile app mapping: [MOBILE-PARITY](MOBILE-PARITY.md).
Status vs the web code on the dev server (`local/web-all`, ee8c53c): `EXISTS` keep · `CHANGE` exists, must change · `NEW` not built · `REMOVE`.

Affordance types ([UX-GUIDE](UX-GUIDE.md#affordances)): **checkbox** (incl. toggle, multi-select tiles) · **pull-down** (incl. radio, segmented, single-choice tiles) · **blank form** (text, textarea) · **button** · **link**. Unlisted affordance = do not add.

Journeys: N = [older adult, new](journeys/older-adult-new.md) · R = [older adult, returning](journeys/older-adult-returning.md) · C = [caregiver](journeys/caregiver.md).

## Index
| Id | Screen | Route (target) | Today | Status | Journeys | Primary action |
|---|---|---|---|---|---|---|
| SH | App shell header | every route | `DashboardShell` title only | NEW | all | — |
| U1 | Onboarding (cards + review) | `/welcome` | `/` mode `onboarding` (`CardDeck`) | CHANGE | N a–i | Show my matches |
| U2 | Home dashboard | `/` | `/` summary card + 3 tabs | CHANGE (major) | N j–k, exit · R a–b1, exit | State-driven (see U2) |
| U3 | Matches | `/matches` | "Matches" tab (`MatchFeed`) | CHANGE | N l · R b3 | Add to my week |
| U4 | Calendar | `/calendar` | "My week" tab (`WeekCalendar`) | CHANGE | R b2 · C f | Open an outing |
| U5 | Activity detail | `/activity/[id]` | none (pieces in cards + Details tab evidence) | NEW | R c2 | Get me there |
| U6 | Profile (your answers) | `/profile` | "Details" tab (`ProfilePanel`, `IntakeSlot`, `EvidencePanel`) | CHANGE | R b4 · C b1 | Save (per row) |
| C1 | Caregiver dashboard | `/care` | none | NEW | C a–e | Open the first thing that needs fixing |
| X1 | Get me there (coordination) | `/coordinate?activityId=` | same | EXISTS, owned by coordination team | N m–o · R c1, d · C c | (theirs) |
| X2 | Shared plan (read-only) | `/plan/[id]` | same | EXISTS (sharing off in UI) | post-hackathon | — |
| — | "Details" tab | — | `/` tab | REMOVE: answers → U6, evidence → U5 | — | — |
| — | Tabs Matches / My week / Details | — | `/` | REMOVE: become routes U3 / U4 / U6 | — | — |
| — | "Or use the classic form" link | — | U1 footer | REMOVE: U6 is the form | — | — |
| — | Demo: Margaret / Harold buttons on first card | — | U1 | REMOVE: moved to SH person switcher | — | — |

---

## SH App shell header — NEW
Shared `layout.tsx` header, `max-w-page` frame, sticky on scroll. Also wraps X1 (integration point).

| Affordance | Type | Why |
|---|---|---|
| "DayBridge" wordmark | link → U2 (or C1 in caregiver view) | Home anchor everyone expects. |
| Home | link → U2 | Dashboard. `aria-current` on the active item. |
| Matches | link → U3 | Find more. |
| Calendar (calendar icon **+ visible word** at ≥ 768px; icon-only with `aria-label` + tooltip below) | link → U4 | Sparsh 2026-10-17: calendar view icon in the header. Icon never alone at desktop (older adults). |
| Profile | link → U6 | "Your answers". |
| Person switcher: "Margaret ▾" | pull-down | Items: Margaret · Harold (demo people, "Demo data" shown once in the menu) · divider · "Caregiver view (for Margaret)". Replaces the onboarding demo buttons. Hackathon exception to "no role switches on user routes" ([UX-GUIDE](UX-GUIDE.md#navigation)). |
| Caregiver view header | text | Replaces nav with: wordmark · "Caring for Margaret" · Care · Calendar · Profile · switcher. Same-device label lives on C1, not in the header. |

Not in header: theme toggle, Print, Share, Start over, AI badge.

## U1 Onboarding `/welcome` — CHANGE
One question per screen, "Card n of N" + progress bar (EXISTS). Back on every card. First-time visitors to `/` with no saved answers are sent here.

| Card | Affordance | Type | Why |
|---|---|---|---|
| Intro | Let's start | button (primary) | One entry. |
| Name | First name | blank form | Free text; blank → "Friend". |
| Interests (10 cards) | Yes / No per card; swipe left/right; arrow keys | button ×2 | Binary per card; swipe is a shortcut, never the only way. EXISTS. |
| | Easier view (all ideas as big tiles) | checkbox (toggle) | Same answers, one screen. EXISTS (relabel "Easier view", drop ": on/off"). |
| | Hands-free (camera) | button, opt-in | Never auto-starts the camera; explicit tap + "Camera stays on this device" line. EXISTS. |
| Times | Mornings / Afternoons / Evenings | checkbox (multi tiles) | Pick-many. EXISTS. |
| Travel | 5 distance options | pull-down (single-choice tiles) | Closed list of 5. EXISTS. |
| **Walking aid** (replaces "stairs" card) | None / A cane / A walker / A wheelchair | pull-down (single-choice tiles) | NEW. Maps 1:1 to `Profile.mobility`; stops inferring mobility from stairs (mobile already does this, `c0mpiled-mobile` ddf2fc3). |
| **How you get places** | I drive myself / Bus or train / Senior shuttle (paratransit) / Family or friends drive me / I walk | checkbox (multi tiles) | NEW. Maps 1:1 to `Profile.transport`; stops inferring transport from mobility. |
| Budget | 4 options | pull-down (single-choice tiles) | EXISTS. |
| **Here's what we heard** | One row per answer (title, value, "(we guessed)" for defaults) + Change per row | link per row (jumps to that card, returns to review) | NEW. Confirm before planning; no surprises. |
| | Show my matches | button (primary) | Runs `/api/analyze`, goes to U2. Disabled with reason text until walking aid + transport are answered. |
| | Hearing / small groups | checkbox ×2, inside one "Optional" disclosure | Not asked as cards (keeps deck short); default off. |

Removed: "Demo: Margaret / Harold" (→ SH), "Or use the classic form" (→ U6).

## U2 Home dashboard `/` — CHANGE (major)
Replaces the summary card + tabs. Heading: "Good morning, Margaret". Width: two columns at ≥ 1280 (left: this week; right: needs attention), one column below.

| Section | Content |
|---|---|
| This week at a glance | One plain line: `weekSummary` ("2 outings · $5 this week"). Under it a 7-day strip (Mon–Sun, dot + name on days with an outing); strip links to U4. |
| Next outing | Name · day + time · how she gets there ("Bus, about 20 min") · status with icon + word (Ready ✓ / Needs your OK / Waiting for replies / Needs a new plan / Not started). |
| Needs attention (max 3 rows, else hidden) | Heads-up rows, amber left rule: NEEDS_REPLAN plans first, then approvals waiting, then one soft barrier for this week's outings ("Choir: noisy room, no hearing loop. Sit near the leader."). Each row: one link. |
| Matches line | "3 more good matches" → U3. One line, not a section. |
| Why these? | Collapsed disclosure: AI explanation, labeled once inside ("Sample AI text" when `dataSource = mock`). |
| States | Building: inline line "Finding activities you can get to…" in the section, rest visible. Error: one line + Try again, last plan kept. No matches: "Nothing fits yet: most were too far." + "Change my answers" → U6. |

Primary action (exactly one, by state):
| State | Primary |
|---|---|
| Any plan NEEDS_REPLAN | **Fix my plan** → X1 for that activity |
| Next outing not started / not Ready | **Get me there** → X1 `?activityId=` (golden path) |
| Everything Ready | **See my calendar** → U4 |
| Week empty | **See matches** → U3 |

| Affordance | Type | Why |
|---|---|---|
| Primary (above) | button | One per screen. |
| Needs-attention row action ("Open", "Review") | link | Navigates. |
| 7-day strip / "See matches" line | link | Navigates. |
| Why these? | checkbox (disclosure) | Progressive disclosure. |
| Try again (error only) | button | Retry. |

Removed from today's summary card: see [UX-GUIDE "Summary card text diet"](UX-GUIDE.md#summary-card-text-diet).

## U3 Matches `/matches` — CHANGE
Heading "Good matches for you". Cards not in the week first, then those already added.

| Affordance | Type | Why |
|---|---|---|
| Match card (bordered: one object acted on) | — | Title (name), one plain meta line "Wed afternoon · Bus, about 15 min · Free" (no chips), max one heads-up row (amber left rule, never amber fill) with workaround; "+1 more" → U5. |
| Card title | link → U5 | Details. |
| Add to my week / In my week ✓ | checkbox (toggle, `aria-pressed`) | Independent yes/no per card. Screen's primary action type; full-width 56px on touch. |
| Get me there → | button (secondary, quiet) | Starts coordination (today a `Link` to X1; keep route). Keeps the Matches → X1 path working. |
| "6 activities didn't fit — see why" | checkbox (disclosure), **collapsed** | Blocked list is explanation, not choice. |
| Inside: one plain row per blocked activity: name + first hard reason ("Too far: 45 min, your limit is 30") | text + link "What would change this" → U6 | No red fills; red icon + word "Didn't fit". |
| Empty | "Nothing fit this week." + Change my answers | link → U6 |

## U4 Calendar `/calendar` — CHANGE
Opened from the header calendar icon. Recurring weekly, "This week" only (no paging in MVP).

| View | Content |
|---|---|
| ≥ 1024px (default) | Week grid: 7 columns × Morning / Afternoon / Evening rows. Each outing block: name, status icon + word, travel mode. Today's column marked "Today" (word, not color only). |
| < 1024px | Day list: only days with outings, plus "Today" even if empty; each row = outing block. |
| Empty | "Nothing in your week yet." + See matches. |
| Caregiver view | Same calendar; status shown; Add/remove hidden. |

| Affordance | Type | Why |
|---|---|---|
| Outing block | link → U5 | Primary action of the screen: open an outing. |
| Week / Day | pull-down (segmented) | Override the width default; remembered per device. |
| Print my week | button (secondary) | Moved from Home; print stylesheet already exists. |
| See matches (empty) | link | Recovery. |

## U5 Activity detail `/activity/[id]` — NEW
| Section | Content |
|---|---|
| Header | Name, "Wed afternoon", place, cost ("Free" / "$5 a week"). |
| Getting there | Best route ("Bus, about 15 min"), other modes as one plain line. Label "estimated" once: "Travel times and access are our estimates, not confirmed by the venue." |
| What could get in the way | One heads-up row per soft barrier: what + workaround (`Barrier.detail` → `mitigation`). Blocked activity: hard reasons + "What would change this" link → U6. |
| How we checked | Collapsed: each passed check as plain text ("Step-free entrance", "Fits your $10 budget"). Never labeled "Verified" (`Evidence.verified` means "check passed", not "confirmed by source"). |
| Coordination status | If a plan exists: status icon + word + link "Open plan" → X1. |

| Affordance | Type | Why |
|---|---|---|
| Get me there | button (primary) | Starts / resumes X1. Hidden for blocked activities. |
| Add to my week | checkbox (toggle) | Same as U3. |
| How we checked | checkbox (disclosure) | Progressive disclosure. |
| Back to Matches / Calendar | link | Returns where she came from. |

## U6 Profile `/profile` — CHANGE
Same rows as U1 review ("Your answers"). Edit one at a time; nothing else moves.

| Affordance | Type | Why |
|---|---|---|
| Change (per row) | button | Opens that row's control inline. |
| Name | blank form | Free text. |
| Interests | checkbox (multi tiles) | Pick-many. |
| Walking aid · Travel limit · Budget | pull-down (single-choice tiles / radio) | Closed lists. |
| How you get places · Times | checkbox (multi) | Pick-many. |
| Hearing help · Prefers small groups | checkbox | Yes/no. |
| Save | button (primary, per open row) | Saves, re-runs `/api/analyze`; inline "Updating your matches…" line; outings that no longer fit become heads-up rows on U2. |
| Describe in your own words (caregiver view only) | blank form (textarea) in a collapsed disclosure → suggested values shown per row with Confirm / Skip | Uses `/api/intake` (confirm-before-apply, [INTAKE_CONTRACT](../daybridge/INTAKE_CONTRACT.md)). Nothing applies without Confirm. |
| Start over | button (quiet, bottom) + undo toast | Destructive → undo, not a confirm dialog. Clears this device's answers → U1. |

## C1 Caregiver dashboard `/care` — NEW
Header in caregiver mode (SH). Heading "Margaret's week". One line under it, shown once: "Same-device demo: no accounts are linked yet. Status is read from this browser's plans." Second line: "Simulated rides and invites: nothing is really sent."

| Section | Content |
|---|---|
| Needs fixing (only if any) | Heads-up rows: NEEDS_REPLAN ("Ride to Cards on Wednesday was cancelled. A new plan is waiting.") then BLOCKED. |
| Approvals waiting | "Waiting for Margaret's OK: ride with Dan, Wednesday afternoon". Plain rows. |
| Her week | One row per outing: day · time · name · status icon + word (Ready ✓ / Needs Margaret's OK / Waiting for replies / Needs a new plan / Not started). Maps from `PlanState` (READY, AWAITING_APPROVAL, PENDING_CONFIRMATION, NEEDS_REPLAN; no plan = Not started). |
| What was shared | Per approved action: recipient, kind, outing, fields (`ActionScope.sharedFields` in words: "first name, pickup window, walking aid"). Revoked ones shown struck with "Revoked". |
| Empty | "Margaret hasn't been set up yet." + Set up Margaret → U1. |

| Affordance | Type | Why |
|---|---|---|
| Open with Margaret (first needs-fixing row) | button (primary) | → X1 for that activity. Caregiver does not approve there by default (GOALS Open). |
| Other row actions | link → X1 / U5 | Navigate. |
| Calendar | link (header) → U4 | Same calendar. |

Integration points (needs coordination team):
- X1 must record plan ids per activity on this device (e.g. `localStorage["daybridge:plans"] = {activityId: planId}`); C1 reads each via `GET /api/coordination/plans/[id]`. No list endpoint exists.
- Hosted production fails closed (503) → C1 shows "Live status isn't available on this server" instead of statuses.

## X1 Get me there `/coordinate` — EXISTS (owned by coordination team; integration only)
- Entry: `?activityId=` from U2 primary, U3 card, U5 primary, C1 rows. Profile handed over via `sessionStorage["daybridge:profile"]` (EXISTS).
- Wrap in SH (shared layout) so Home / Calendar are one click away; add "← Back to home" link.
- Asks (not changes we make): hide raw `READY` / `plan v2` badges behind a details disclosure; one "Simulated" label (keep); heading "Get me there" for the person, "Get them there" only in caregiver view; demo simulator stays clearly labeled "Demo".
- Write plan id per activity for C1 (above).

## X2 Shared plan `/plan/[id]` — EXISTS
- Read-only redacted snapshot ([SHARE_CONTRACT](../daybridge/SHARE_CONTRACT.md)). UI entry stays hidden while `SHARE_AVAILABLE = false`; when on, "Share my week" lives in U4 next to Print. Never a disabled "coming soon" button.
