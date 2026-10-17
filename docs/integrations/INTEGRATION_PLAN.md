# DayBridge — Third-Party Integration Plan

Branch: `intg/third-party`. Owner: Teammate A. Last updated: 2026-10-17.

Rule from `docs/handoffs/README.md`: every new npm package needs lead approval before install. Server-only keys never use the `NEXT_PUBLIC_` prefix; only `.env.example` is committed.

## Priority order

### P0 — Places API (New): venue + accessibility data
Why first: maps the engine's `stepFree` field to real data (`wheelchairAccessibleEntrance`), turning seeded Evidence checks into verifiable claims — the reviewers' biggest flagged gap.
- APIs to enable: Places API (New). One key, restricted to that API.
- Use: venue name/address lookup; accessibility fields for `stepFree`; opening-hours sanity for `when`.
- Env: `GOOGLE_MAPS_API_KEY` (already in `.env.example`).
- No SDK needed — plain `fetch` to `https://places.googleapis.com/v1/places:searchText` with field masks. **No new package.**
- Demo fallback: if no key, keep seeded data and label Evidence "estimated".

### P0 — Google Calendar: "Add to my calendar"
Why: cheapest follow-through story; no backend state.
- Options: (a) plain Google Calendar web links per plan item (zero OAuth, zero packages — dates in the link URL), or (b) OAuth via `GOOGLE_CLIENT_ID/SECRET` for real account writes.
- Demo choice: (a). Links work instantly, no consent flow on stage, no package.
- Keep (b) as stretch if time allows.

### P1 — Weather (Open-Meteo): replan story
Why: live "it might rain Saturday → here's the indoor alternative" beat for the pitch.
- `https://api.open-meteo.com/v1/forecast` — free, no key, no package.
- Server-side fetch next to the analyze route; only touches UI-owned display + a note in Evidence. Coordinate schema additions with the lead.

### P1 — Shareable plan link + caregiver email
Why: completes the caregiver loop the lead's `/plan/{id}` starts.
- Share link: lead's Supabase work (not ours).
- Caregiver email: single server-side `fetch` to Resend's REST API. **No SDK package.** Needs `RESEND_API_KEY` — ask lead before adding env var.

### P1 — Rideshare (Uber + Lyft) — DONE
- Deep links always on: `m.uber.com/ul/` + `lyft.com/ride` with destination pre-filled (Berkeley Civic Center default pickup; coordinates come from Places when a key exists).
- Real fare estimates: `UBER_API_TOKEN` (server-only, price_estimates scope) → shows "est. $X–$Y each way". Fails soft without a token.
- Zero packages.

### P2 — Transit reality (slide material)
- AC Transit GTFS open feed for real bus minutes; East Bay Paratransit deep link for the workaround text.
- Not demo-critical; document, don't build unless time allows.

### P2 — SMS reminders (Twilio)
- Most realistic channel for this audience; needs new package + paid account.
- Post-demo only. Mention in pitch as roadmap.

## Not doing (scope creep)
Payments, senior-facing auth, native apps, full OAuth flows on stage.

## Demo-critical path
1. Places accessibility fields → Evidence looks real
2. Calendar web links → actionable plan items
3. Weather note → replan moment
4. Share link (lead) → caregiver loop

## Package requests needing lead approval
- None for P0/P1 items above (all plain `fetch`).
- Twilio SDK only if SMS is greenlit post-demo.
