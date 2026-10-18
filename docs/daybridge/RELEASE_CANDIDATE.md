# DayBridge: Release Candidate (`rc/daybridge`)

**Status:** the RC is functional, and the scope is frozen. Everything below was verified on this branch on 2026-10-17. Nothing has been deployed.

## What's in it
`main` (#1 docs, #3 coordination engine, #4 audit, #9 follow-ups) plus:
- **#10** `ui/polish`: dashboard and the "Get me there" link
- **#14** `ui/coordination`: the `/coordinate` screen
- **#13** `data/real-activities`: real Berkeley activities
- **#7** GLM phase-2 simulation tests
- **#16** `npm run demo:check`
- **integration patch `96cc18e`:** "Get me there" carries the planner's profile to `/coordinate` through `sessionStorage`

**Not in the RC (deferred):**
- **#12 (swipe onboarding):** it removes the "Get me there" link and conflicts with this branch.
- **#11 (`intg/third-party`):** the issue #6 blockers are still open: calendar format, unverified Places data, unlabeled live data, a fabricated drop-off location, and the weather date.
- **#2:** its tests exercise a copied version of the planner.
- **#8 (CI/monitor workflows):** not needed for the demo; your decision.
- **#18** (demo endpoint, caregiver narrative, F3 cancel fix): green, but a new feature, so frozen out. Merge after the demo.
- Issue **#17** (activity provenance/estimated signals): post-demo.

## Verified
| Check | Result |
|---|---|
| `npm run check` | exit 0; typecheck clean, lint clean, **158/158 tests** (6 files) |
| `npm run build` | exit 0; `/`, `/coordinate`, `/api/analyze`, and 4 `/api/coordination/*` routes |
| `npm run demo:check` × 2 on a production build | **ALL PASS both runs** (11 steps, about 0.5 s each, 26 events) |
| Independent HTTP verification (subagent) | 33/33: both demo profiles, every "Get me there" activity (none falsely BLOCKED), golden path ×2 plus interleaved, restart, 400/404/forged-event handling, events 403 without the flag, every request < 1 s |
| `/coordinate` review (subagent) | the page's exact requests work against the engine; state comes from the server only; "requested" is never shown as booked; the "Simulated providers" label is shown |
| Stale stored profile | fixed: on a 400, `/coordinate` clears `daybridge:profile`, so Try again falls back to Maya |
| Browser | **not run.** Claude in Chrome isn't connected in this session. Click through the walkthrough below once before judging |

## Run locally
```bash
git checkout rc/daybridge && npm ci
npm run build
# bash:       DAYBRIDGE_DEMO_EVENTS=1 npx next start -p 3000
# PowerShell: $env:DAYBRIDGE_DEMO_EVENTS='1'; npx next start -p 3000
npm run demo:check            # optional pre-flight against http://localhost:3000
```
`npm run dev` works too, because demo events are always on in dev. AI explanations: leave `AI_BASE_URL` unset for the mock (offline-safe), or set it in `.env.local` to a model endpoint. Restarting the server wipes coordination plans (in-memory by design), and **Load demo** recreates one.

## Demo walkthrough (about 3 minutes, repeatable)
1. `/demo` (or **Try it now** on the `/` landing page) → **Load demo: Margaret**. The plan cards appear, and **Why not these?** shows the choir blocked: stairs + walker.
2. Open `/coordinate` (or click **Get me there** on a card with a ride) → **Load demo: Maya**, for Sunday Fellowship Lunch.
3. The plan offers **a ride from Dan + an invite to Elaine** (it's a big group). **Accept plan.**
4. Show the consent cards: **exactly what's shared** for each action. Click **Send** first, and it's refused (no approval). Then **Approve** both and **Send**.
5. The confirmations show ⏳ waiting (requested ≠ booked). Simulate **Elaine accepts**, then **Ride confirmed** → **READY ✓**.
6. Simulate **Ride cancelled** → **NEEDS_REPLAN**: READY revoked, paratransit proposed, Elaine still confirmed.
7. **Accept**, then **Approve** the new ride (the old approval doesn't carry over), **Send**, and **Ride confirmed** → **READY ✓**.
8. **Mark as attended** → **Too far** (*not* "Too crowded": Maya already prefers small groups) → "I heard: max travel 20 min" → **Confirm** → profile v2.
9. Optional: open the timeline to show the event log, including duplicates and rejected events.

## Remaining blockers (none block the local demo)
- **No persistence and no auth on `/api/coordination/*`. Do not deploy publicly as-is.** See `PERSISTENCE_AUTH_PROPOSAL.md`.
- "Save & share" calls `/api/plans`, which doesn't exist (it fails soft with "not available yet"). Don't click it during the demo.
- Browser click-through not yet done by an agent.

## Recommended merge sequence (each step needs lead approval)
1. Merge this RC PR into `main`, or merge in this order: #14 + #10 (together) → #13 → #7 → #16 → integration patch.
2. After the demo: #12 (after a rebase with the link and handoff restored), #11 (after issue #6), #2 (after the rework), #8 (after your call).

## GO / NO-GO
**GO for a local or single-instance demo.** **NO-GO for a public deploy** until auth and persistence are in.
