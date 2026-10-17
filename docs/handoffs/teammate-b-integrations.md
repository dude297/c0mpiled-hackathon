# Teammate B — Integrations setup, provenance and demo fallback

Owner: Teammate B (`hiromaruyama`). Branch: `intg/third-party` (PR #11). Contracts: `docs/integrations/INTEGRATION_PLAN.md`, `docs/integrations/SCHEMA_PROPOSAL.md`.

## What actually connects externally (demo honesty list)

| Feature | Mode | Key needed | Fails soft? |
|---|---|---|---|
| Venue address + wheelchair-entrance claim | **live** (Google Places New, Text Search) | `GOOGLE_MAPS_API_KEY` | yes — returns `null` |
| "Add to Google Calendar" links | constructed web links (no API) | none | n/a — always works |
| Rain check for outdoor items | **live** (Open-Meteo, no key) | none | yes — returns `null` |
| Uber/Lyft deep links | constructed deep links | none | skipped without Places coords |
| Uber fare estimate | **live** (Uber Estimates API) | `UBER_API_TOKEN` | yes — `estimate: null` |

Nothing books, sends or confirms anything. Deep links are a handoff for the user to tap; they are not a `ProviderPort` and never mark a ride dependency confirmed.

## Provenance rules

- Every Google-sourced claim renders as **unconfirmed** (`verified: false`, "via Google", "Google says … — unconfirmed by the venue"). Crowd-sourced accessibility data is never shown as a green pass.
- Weather/estimates render with source labels (`live: Open-Meteo`, `Uber estimate · live`).
- Enrichment is **opt-in**: `DAYBRIDGE_ENRICH=1`, total budget 2.5 s (`Promise.race` in `src/app/api/analyze/route.ts`). Unset → base deterministic plan only, identical to offline.
- Deep links are skipped entirely when Places gives no coordinates — no venue name is ever aimed at a made-up location.
- Pickup is honestly labeled "Berkeley Civic Center (demo)" — not the user's home.

## Offline / fallback demo sequence

1. Without `DAYBRIDGE_ENRICH` (or without keys): plan, evidence, calendar links and everything deterministic is unchanged — badge stays `mock`/`live` per AI only.
2. With `DAYBRIDGE_ENRICH=1` and keys, kill network mid-demo: each lookup times out at 4 s inside the 2.5 s race → response falls back to base plan; nothing crashes, nothing fabricates.

## Setup

```bash
cp .env.example .env.local
# Optional, for live enrichment:
#   GOOGLE_MAPS_API_KEY= (Places API (New) enabled)
#   UBER_API_TOKEN= (server token, price_estimates scope)
# Then: DAYBRIDGE_ENRICH=1 npm run dev
```

## Tests

`DAYBRIDGE_ENRICH` is unset in tests → zero network calls in the suite. Verify with `npm run check`.

## Audience-estimate research note (Issue #17 follow-up, P2 stretch)

Many activities older adults enjoy aren't labeled "senior" or "55+". Examples in the East Bay, all open to everyone but skewing older in practice:

- **Service clubs (Kiwanis, Rotary, Lions, Optimist):** daytime lunch meetings, low-noise, structured social format. Membership skews 50+ (Rotary International and Kiwanis publish aggregate member demographics; see rotarystatistics and club census reports).
- **Berkeley Public Library programs** (book groups, lectures, tech help): weekday daytime slots; attendance skews retired adults per branch programming staff notes.
- **City of Berkeley parks & rec adult programs:** morning/afternoon classes at the two senior centers already in the catalog, but also general adult programs (aquatics, community gardens) with significant 60+ enrollment per the department's class rosters.
- **Community gardens (Berkeley Community Gardening Collaborative):** daytime, low-barrier, consistent older-adult participation in East Bay garden surveys.

Scoring idea (estimated, never verified): per activity *type*, combine (a) Census ACS 65+ share for the surrounding census tract, (b) published membership/participation demographics, (c) structural signals (daytime slot, group size, noise, seated format). Produce `olderAdultLikelihood: "high" | "medium" | "low"` with a `basis` string and `sourceUrl`, always `verified: false`. The engine should treat this as a soft ranking signal only — never a hard filter, never excluding unlabeled activities (Issue #17, engine owner: lead).

Guardrails: public pages only, respect robots.txt and site terms, aggregate demographics only (no profiling of individual attendees), keep the offline fallback. Individual attendance is never inferred.

## Known limits

- Uber price estimates with a *server* token may 403 in some account configs — deep links remain unaffected (by design).
- Places `maxResultCount: 1` + `locationBias` (20 km around Berkeley) can still mis-resolve a name; coordinates come only from that single biased result, and rideshare links are skipped if coordinates are missing.
- The weather check only flags rain for one outdoor keyword match (`garden|walk`) — it's a demo signal, not a forecast service.
