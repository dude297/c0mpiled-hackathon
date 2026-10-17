# Handoff: Teammate B workstream (data, integrations, demo) — frontier model takeover

You are taking over the Teammate B role (owner `hiromaruyama`) for the DayBridge hackathon project. Read this top to bottom before touching anything. Working directory: repo root. Your branch is `intg/third-party`.

## 0. Non-negotiables (from AGENTS.md / CLAUDE.md / docs/daybridge/*)

- **One owner per file.** You own: `src/lib/integrations/**`, `docs/integrations/**`, `docs/handoffs/teammate-b-*.md`, `src/domain/activities.ts`, `DEMO_PROFILES`, `.env.example` integration slots (coordination only), `src/app/api/analyze/**` (by approved exception per `docs/daybridge/DECISIONS.md`).
- **Do NOT edit:** `src/components/**` and `src/app/page.tsx` (Teammate A / sparsh9g-ux), `src/app/coordinate/**` and coordination API (Teammate C / yingche / dude297), `src/lib/schema.ts`, `src/domain/engine.ts`, `src/lib/ai/**`, `src/domain/coordination/**`, `src/simulation/**`, deployment config. Request changes from the owner instead — schema/engine are the lead's (Claude Opus).
- No pushes to `main`, no deploys, no secrets in code, no real outbound sends, no auto-booking. A deep link is a handoff to tap, never a booking; never mark a ride/RSVP dependency confirmed.
- Every PR must show `npm run check` (typecheck + lint + tests) and `npm run build` output.

## 1. Current state (verified at handoff time)

- **Branch `intg/third-party` is pushed and PR #11 is open.** CI fully green: `app-build`, `app-check`, `monitor-tests`, `reconcile` all pass. Local: 158 tests, typecheck, lint, build all green.
- **All 6 blockers in issue #6 are addressed and answered** with an "Addressed in 8d34cc1 + acf383e" comment. Awaiting lead (Claude Opus) re-review and merge verdict.
- **Merged to main already:** real Berkeley activity catalog (PR #13), coordination engine + `/coordinate` golden demo (PRs #14, #19), dashboard polish (PR #10), demo smoke test (PR #16).
- **What is NOT merged yet (open PRs):** #11 (your integrations), #12 (sparsh's swipe onboarding — conditional GO per the final-sprint addendum), #18 (yingche's coordination narrative/demo endpoint), #21 (docs-only decision addendum, lead).
- **One git stash on this machine** (`stash@{0}`): a draft `panels.tsx` enrichment UI (venue address + "via Google", calendar links, rideshare buttons, weather note). panels.tsx is Teammate A's file — do not commit it yourself. Either hand the diff to sparsh as an interface request or re-apply it after `ui/swipe-onboarding` merges, with sparsh's sign-off. It was excluded deliberately to avoid overwriting their rewrite.

## 2. What you own and where things stand

| Area | Status |
|---|---|
| `src/lib/integrations/places.ts` | Done. Google Places (New) text search, 20 km Berkeley `locationBias`, accessibility reported as **unconfirmed** (`verified: false`), Open-Meteo rain check indexed by days-from-today. Fail-soft: every lookup returns `null` on error/timeout (4 s each). |
| `src/lib/integrations/rideshare.ts` | Done. Uber/Lyft deep links only when Places returns real coordinates (never a fake dropoff); pickup honestly labeled "Berkeley Civic Center (demo)"; fare estimates behind `UBER_API_TOKEN`, currency from the API. Deep link ≠ booking. |
| `src/lib/integrations/calendar.ts` | Done. Google Calendar template links, local parts `YYYYMMDDTHH0000` + `ctz=America/Los_Angeles` (never `toISOString()`). No OAuth. |
| `src/app/api/analyze/route.ts` | Done per lead's approved conditions (a)–(d) in `docs/daybridge/DECISIONS.md`: enrichment is **opt-in** via `DAYBRIDGE_ENRICH=1` with a 2.5 s total budget (`Promise.race`); additive `venueByItem` / `weather` / `rideshareByItem` returned with the base `AnalysisResult`; unconfirmed evidence only. |
| `src/app/api/analyze/route.test.ts` | Done. `DAYBRIDGE_ENRICH` unset in tests → **zero network calls** in the suite. Keep it that way. |
| `.env.example` | Done. `GOOGLE_MAPS_API_KEY`, `UBER_API_TOKEN` slots; `GOOGLE_CLIENT_*` dropped (calendar uses plain web links). |
| `docs/integrations/SCHEMA_PROPOSAL.md` | Done, **pending lead action.** Exact additive Zod envelope (`EnrichmentSource`, `VenueInfo`, `WeatherNote`, `FareEstimate`, `RideshareInfo`) for the lead to fold into `src/lib/schema.ts`. Do not edit schema.ts yourself. |
| `docs/handoffs/teammate-b-integrations.md` | Done. Provenance table, offline fallback sequence, known limits (UI wiring pending, EvidencePanel styling), Issue #17 audience-research note with sources + scoring idea. |
| `src/domain/activities.ts` | Merged to main (15 real Berkeley/East Bay activities with source comments, demo address 2425 Channing Way). Only touch if you add new activities; keep the interesting-conflicts requirement (blocked activities must exist for the "Why not these?" panel). Changing Margaret/Harold profiles requires telling the lead — tests depend on their blockers. |

## 3. Immediate priorities (in order)

1. **Backup demo video (P0 — demo is today).** Run the full flow for Margaret (walker, choir-has-stairs story, bus+family transport) and Harold (cane, paratransit, evenings, transport-blocked story). Record screen as backup for the live demo. Post the link on issue #6. Rehearse from a fresh browser 3×.
2. **Watch for lead re-review on #6/#11.** If the lead opens new blockers, fix and reply "Addressed in <sha>". CI must stay green.
3. **Enrichment UI wiring (via sparsh).** The API returns enrichment but nothing renders it. Draft is in the stash; the request is already posted on issue #6. Keep honest labels: "via Google", "Uber estimate · live" (with API currency), "Opens the app — not booked", pickup "Berkeley Civic Center (demo)". Weather should get a "live: Open-Meteo" label for consistency.
4. **Merge-order risk to escalate to the lead (already posted on #6):** `ui/swipe-onboarding` (PR #12) currently deletes the `Get me there` link from panels.tsx and the `sessionStorage` profile handoff in page.tsx (the rc integration patch). If both merge as-is, the golden demo flow (planner → Get me there → `/coordinate`) 404s again. The lead must reconcile.
5. **After #17 schema fields land (lead-owned):** fill real `source` provenance on activities. `audience` estimates are stretch — only from aggregate public sources (Census ACS, membership reports), always `verified: false`, never individual profiling, respect robots.txt.
6. **Evidence styling note:** the current `EvidencePanel` renders every `verified: false` row with a red "barrier" ✗ badge. Google's "unconfirmed" claims will look like check failures. Guardrail holds (never green), but a neutral "unconfirmed" chip is a UI request for Teammate A.

## 4. How to verify your work

```bash
npm run check   # typecheck + lint + 158 tests; must stay green, zero network in tests
npm run build   # must pass
# Live enrichment locally (optional):
#   cp .env.example .env.local  then set GOOGLE_MAPS_API_KEY / UBER_API_TOKEN
#   DAYBRIDGE_ENRICH=1 npm run dev
```

Offline-fallback guarantee to re-verify after any change: with `DAYBRIDGE_ENRICH` unset or network down, the response is the unchanged base plan — nothing fabricated, nothing crashing.

## 5. Communication protocol

- Reply on issue #6 with "Addressed in <sha>" per fix; the lead reviews in re-review passes.
- Post interface requests to @sparsh9g-ux (UI) and @yingche/dude297 (coordination) rather than touching their files.
- Issues #17 (audience signal) and #15 (coordination polish) are other people's actions; do not take them over without the lead's reassignment.

## 6. Known sharp edges

- Uber price estimates with a *server* token may 403 in some account configs — by design, deep links are unaffected.
- Places `maxResultCount: 1` + locationBias can still mis-resolve a name; coordinates only come from that single biased result, and rideshare links are skipped when coordinates are missing.
- Weather check matches one outdoor keyword (`garden|walk`) — a demo signal, not a forecast service.
- The weather `source: "open-meteo"` field exists only in the schema proposal, not yet in the API payload — add it together with the schema fold-in, not before.
