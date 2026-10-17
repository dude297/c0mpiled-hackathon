# Rehearsal checklist (run after UI + Supabase merges)

Do this 3 times from a fresh browser tab (Cmd+Shift+N). Note every slow/confusing/broken moment and send the list to the lead.

## Before each run
- [ ] `npm run dev` fresh, wait for "Ready"
- [ ] Browser zoom 110%, no dev tools open
- [ ] `.env.local` in place; note whether the mock-AI or live-AI badge shows (mention it honestly on stage)

## Run-through script
1. Land on `/` — can you tell what the product does in 5 seconds? (plan-first layout)
2. Click **Load demo: Margaret** — plan appears < 2s?
3. Read the two plan cards aloud — are day/time/cost/workaround obvious?
4. Scroll to **Why not these?** — is the choir reason plain-spoken?
5. Open **Every check we ran** — do the sources make sense?
6. Click **Get me there →** on a plan card
7. On `/coordinate`: Accept → approve both cards → Send → simulate "Elaine accepts" + "Ride confirmed" → READY
8. Simulate "Ride cancelled" → NEEDS_REPLAN → accept → re-approve → re-send → confirm → READY again
9. Mark attended → "Too far" → Confirm patch (Maya already prefers small groups, so "Too crowded" proposes nothing — use "Too far", 30 → 20 min)
10. Back on `/`: **Load demo: Harold** — plan differs and makes sense?
11. Cmd+P print preview — does the plan print cleanly?

## Times to note
- Total wall-clock for steps 1–10: ______ (target under 2:30)
- Anything you had to explain out loud for the demo to make sense: ______

## After 3 runs
- [ ] Send the lead: what felt slow, what felt confusing, any API errors seen
- [ ] Confirm the backup video exists and plays
- [ ] Verify the two fallback paths: (a) no AI key → mock badge still fine; (b) coordination page restart → plans wiped, demo button recreates
