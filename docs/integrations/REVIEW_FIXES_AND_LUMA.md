# Integration repairs and public Luma discovery

Owner: Teammate B. Branch: `intg/third-party`. No deployment or external writes.

## Repairs

- Places no longer guesses a venue from a program name or the first Text Search result. Set server-only `DAYBRIDGE_VENUE_PLACE_IDS` to a JSON object of activity IDs to **human-reviewed canonical Google Place IDs** (for example `{"garden":"YOUR_REVIEWED_PLACE_ID"}`). Review that the particular activity actually occurs at that venue before mapping it. Unmapped activities, invalid configuration, mismatched returned IDs, incomplete addresses, invalid coordinates, and places more than 20 km from Berkeley return null, with no rideshare handoff. The catalog's intentionally synthetic/conflicting demo locations must not be mapped to a real venue without review. No mappings are invented or enabled by this patch.
- Venue details use Google's documented Place Details (New) endpoint: https://developers.google.com/maps/documentation/places/web-service/place-details . Accessibility remains an unconfirmed provider claim, never a planner constraint update.
- Weather and calendar use the same next-occurrence date in America/Los_Angeles, strictly after today's LA date, matching the existing calendar convention. Weather matches that date against `daily.time`. Out-of-horizon/missing/null/invalid codes return no note. Snow/ice also count as precipitation concerns. Calendar construction no longer depends on the server's timezone.
- Invalid coordinates do not generate ride links; invalid/negative/reversed fare ranges or missing currency do not generate fare estimates.

## Luma public discovery

User requested **public local event discovery**, not an organizer-calendar connection.

Luma documents public city iCal subscriptions: https://help.luma.com/p/ical-syncing . On https://luma.com/sf the Add iCal Subscription control exposes `https://api.luma.com/ics/get?entity=discover&id=discplace-BDj7GNbGlsF7Cka`. This published feed is the connector source; no private API scraping, organizer key, new package, or registration is used.

- Enable locally with `DAYBRIDGE_LUMA=1`; call `GET /api/integrations/luma`.
- Disabled by default: `{status:"disabled",events:[],sourceUrl:"https://luma.com/sf"}` and zero network requests.
- Enabled: fetch the fixed public feed with a 2.5 s timeout, no cache and no redirects. Failures return `status:"unavailable"` with no events. A successfully parsed feed returns `status:"live"` (including when no supported future events remain).
- Candidates contain `id`, `name`, `startsAt`, `endsAt`, `location`, `url`, `source:"luma"`, `verified:false`, and `checkedAt`.
- The San Francisco discovery page includes the broader Bay Area. These are discovery candidates, **not a guarantee of Berkeley proximity**. Exact location can be missing; no travel time is inferred.
- Parser supports future single-occurrence UTC timed events; skips cancelled/private events, recurrence, floating/local/all-day times, invalid dates and non-Luma URLs. It unfolds iCal lines and decodes text escapes. It returns at most 100 candidates.
- Imported events are not inserted into the deterministic catalog: price, transport, accessibility, noise and group size remain unknown. No attendance, RSVP or booking is inferred.

### Owner interface requests

- **Sparsh/UI owner:** consume the discovery endpoint separately from feasible plans, render source and unknown details, and open `url` only as a user handoff. This patch does not edit UI files. The onboarding issue in PR #12 (inferring driving/family/paratransit and mobility aids from stairs answers) still requires explicit questions/review in the UI owner's branch.
- **Lead/schema owner:** pending enrichment schema proposal remains in `SCHEMA_PROPOSAL.md`; do not claim schema/UI integration is complete. New server environment settings are documented here; lead can add them to the reserved `.env.example` slots.

## Verification

`npm run check`: typecheck + lint pass; 8 test files, **191 tests passed**, including 33 new offline regression tests. All external fetches in connector tests are stubbed.

`npm run build`: fails in this environment with Turbopack `binding to a port: Operation not permitted`, including the escalated run; no successful new build is claimed.

The public subscription URL was verified in Luma's UI. The live feed download was not approved, so actual provider payload compatibility and live event retrieval remain unverified. No live Google/Uber credentials were used. Do not describe Luma as demonstrated end-to-end until the feed and UI are exercised.

## Luma hardening follow-up

Complete, balanced iCal components are required before a feed is labeled live. Repeated optional properties are accepted; duplicate required fields remain rejected. Nested alarm properties cannot overwrite event details. Downloads are counted by bytes during streaming and cancelled above 2 MB, including without content-length. UTF-8 decoding preserves characters across chunks and rejects invalid encoding. Fetch explicitly omits credentials and referrers. All follow-up verification used synthetic streams; no live requests were made. Local/floating/all-day timestamps remain explicitly unsupported and are skipped rather than assigned an invented time.
