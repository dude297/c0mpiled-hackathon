# UX + style guide (for agents)

Adapted from Colleagent's UX-GUIDE for an older-adult audience. Applies to every screen in [SCREENS.md](SCREENS.md). If a rule blocks a feature, stop and ask; do not work around it.

## Flow
- Every screen serves a journey step in [journeys/](journeys/). No journey step → no screen.
- One primary action per screen. Everything else is visually quieter (secondary, quiet, link).
- First visit → U1 Onboarding. Returning → U2 Home from the device store ([DS](SCREENS.md#ds-device-store--new-client-state-no-ui)), never onboarding again.
- Never block navigation; block only the action that truly needs a missing answer (e.g. "Build my week" needs walking aid + transport).
- Prefill everything known. Never ask the same thing twice (U1 review and U6 Profile are the same rows).

## Speed and calm
- Fewest screens, fewest choices per screen (≤ 5 options visible; more → "Easier view" tiles or a disclosure).
- No full-page loaders. A section that's working shows one inline line in place ("Finding activities you can get to…"); the rest stays usable.
- No consoles, event logs, scores, rule ids or state codes (`READY`, `plan v2`) on user screens. Words + icons only.
- When something changes in the background (ride cancelled), flag it on Home as a heads-up row; never a pop-up.

## Navigation
- Header (SH): brand · Home · Matches · Calendar (icon + word) · Profile · person switcher. Caregiver view: brand · "Caring for {name}" · Care · Calendar · Profile · switcher.
- No nav item outside a journey.
- **Hackathon exception:** the person switcher (You / Margaret / Harold / Caregiver view for {name}) is a demo and role switch on user routes. It is labeled "Demo data" once inside the menu. Remove when real accounts exist.

## Affordances
| Use | When | Not |
|---|---|---|
| **checkbox** (incl. toggle, multi-select tiles, disclosure) | Independent yes/no or pick-many | Single choice |
| **pull-down** (incl. radio, segmented, single-choice tiles) | Exactly one from a closed list | Free text |
| **blank form** (text, textarea) | Free input we can't enumerate (name, "describe in your own words") | When a closed list exists |
| **button** | Performs an action (save, approve, add, start coordination) | Navigation |
| **link** | Navigates | Actions |
- Every affordance is listed in SCREENS.md with type + why. Unlisted = do not add.
- Destructive (Start over, Cancel plan, Revoke): button + undo, not a confirm dialog. Exception: X1 Cancel plan is theirs.
- Optional inputs live behind one collapsed "Optional" disclosure.
- Swipe, tilt and gaze are shortcuts, never the only way. Every card has visible Yes / No buttons.
- Camera (Hands-free) starts only after an explicit tap; never on page load, never on the judged demo by default.

## Older-adult type and targets
| Token | Size | Use |
|---|---|---|
| meta | 16px | Help text, timestamps (minimum anywhere) |
| body | **18px** (≥ 17px hard floor) | All body text, row text, button labels |
| lead | 20px | Next-outing line, card titles on mobile |
| h3 | 22px | Card titles (desktop), section titles |
| h2 | 28px | Page sections (one size per page) |
| h1 | 36px | Page title ("Good morning, Margaret") |
- Line height ≥ 1.5 for body. Max line length 65ch.
- Targets ≥ 44px tall everywhere; **56px on touch** (primary buttons, tiles, tab bar). Today's `min-h-11` (44px) passes desktop only.
- Contrast ≥ 7:1 for body text (AAA), ≥ 4.5:1 for meta.
- Focus ring visible on every control (existing `FOCUS` class).
- Plain words: "Get me there", "Your week", "Didn't fit". No "feasible", "intervention", "barrier", "mitigation" on screen.

## Casing and labels
- Sentence case everywhere: headings, buttons, nav, tags.
- **No uppercase eyebrows** (today's "SUGGESTED PLAN"). A heading alone is enough.
- No eyebrow or kicker above headings. No letter-spacing.

## Surfaces: when to box
| Surface | When |
|---|---|
| Plain (default): spacing + hairline dividers | Sections, lists, rows, forms |
| Bordered card | One object acted on as a whole: a match card, an outing |
| Tinted panel | **At most one per view.** Only a real stop ("Can't go yet"). |
| Heads-up row | Warnings, soft barriers, "needs attention": white row, **4px amber left rule** + icon + word. **Never a cream/amber fill** (today's `bg-amber-100` match-card notes must change). |
- No drop shadows on cards (menus/popovers only). No dashed borders as decoration (today's dashed "not added" cards → plain border).
- One meaning per color: green = Ready / confirmed only; amber = heads-up; red = didn't fit / can't go; primary = action. Never color alone: always icon + word.

## Tags
- At most one status per row (Ready / Needs your OK / Waiting / Needs a new plan / Didn't fit).
- Secondary info (day, travel, cost, counts) is plain text in one meta line, never chips: "Wed afternoon · Bus, about 15 min · Free".

## Progressive disclosure
- The AI explanation is collapsed behind "Why these?" (U2), never above the fold.
- Blocked "why not" list is collapsed (U3). Passed checks are collapsed (U5 "How we checked").
- Optional profile fields (hearing, small groups) are in one "Optional" disclosure.

## Truthfulness
- Say each truth label **once per screen**, where it applies, in words:
  - AI: "Sample AI text" (mock) / "Written by AI" (live), inside the "Why these?" disclosure only.
  - Coordination: "Simulated: no real messages or rides are sent" (X1, C1).
  - People: "Demo data" (person switcher menu).
  - Activity facts: "Travel times and access are our estimates, not confirmed by the venue" (U5). Real listings, estimated fields (`activities.ts` comments).
  - Caregiver: "Same-device demo: no accounts are linked yet" (C1).
- Requested ≠ confirmed: "Asked Dan" vs "Dan said yes". RSVP ≠ attended.
- `Evidence.verified` means "this check passed"; never render it as "Verified".
- Never show a disabled feature as a promise ("Sharing: coming soon"). Hide it until it works.

## Web first, then 390, then Expo
- Design and screenshot at **1440 and 1280** first, then **390** with parity: same journeys, same primary action, fewer columns.
- No horizontal scroll at 390. Week grid → day list below 1024px.
- Primary action reachable by thumb at 390: sticky bottom bar on long screens (U5, U6 open row).
- Mobile app (Expo) runs the same journeys with native idioms: [MOBILE-PARITY](MOBILE-PARITY.md).

## Summary card text diet
Today's dashboard summary card (`src/app/page.tsx`) has: an uppercase "SUGGESTED PLAN" eyebrow, the summary as h2, a "mock AI" badge, a long AI explanation paragraph, "Suggested:" + 5 stat chips (Matching interests, Feasible, Blocked, Weekly cost, Barriers to work around), a tinted "In your week" banner, and 4 buttons (Print, Save & share (disabled), "Sharing: coming soon", Start over). Replace with U2 Home:

| Today | Becomes |
|---|---|
| "SUGGESTED PLAN" eyebrow | Removed. Page heading "Good morning, {name}". |
| `result.summary` h2 ("3 activities Margaret can actually attend this week.") | One plain line: `weekSummary` ("2 outings · $5 this week"). |
| "mock AI" badge | Removed from the card; label sits inside "Why these?" once. |
| AI explanation paragraph | Collapsed "Why these?" disclosure. |
| 5 stat chips | Gone. "Matching / Feasible" → one line "3 more good matches" (link U3). "Blocked" → count inside U3's collapsed "didn't fit". "Weekly cost" → in the week line. "Barriers to work around" → needs-attention heads-up rows (max 3). |
| Tinted "In your week" banner | 7-day strip (plain). No tint on Home unless something truly can't go. |
| Print | U4 Calendar, secondary. |
| Save & share + "coming soon" | Hidden until sharing works; then "Share my week" in U4. |
| Start over | U6 Profile, quiet button + undo. |
| (missing) | **One** primary button by plan state ([U2 table](SCREENS.md#u2-home-dashboard---change-major)): Fix my plan / See what's in the way / Continue my plan / See status / Get me there / See my calendar / See matches. |
