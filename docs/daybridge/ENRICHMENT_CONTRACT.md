# Enrichment contract for `/api/analyze`

Status: additive schema for PR #11 (`intg/third-party`, reviewed at `41ed0a7`). Owner of the provider code: Teammate B. Owner of `schema.ts`: the lead.
Source of truth: `src/lib/schema.ts`, in the "Enrichment contract" region at the end of the file. Tests: `src/lib/enrichment.test.ts`. They make no network calls.
Implements DECISIONS.md L2 and the 2026-10-17 conditions (1)–(4).

## Schema

All four fields are **optional** on `AnalysisResult`. A response without them is the unchanged base plan.

```ts
Provenance      { source: "live" | "estimate" | "mock"; provider: string; fetchedAt: ISO-8601 datetime; verified: false }
VenueInfo       { name; address?; lat?; lng?; accessibility?: { wheelchairEntrance?: boolean | null }; provenance }
WeatherNote     { date: "YYYY-MM-DD"; summary; precipitationChance?: 0..100; outdoorConcern?: boolean; provenance } | null
RideshareOption { provider: "uber" | "lyft"; deepLink: https URL; fare?: { low; high; currency: /^[A-Z]{3}$/ } (low <= high);
                  pickupLabel; notBooked: true; provenance }
EnrichmentMeta  { enabled: boolean; budgetMs: int 0..2500; timedOut: boolean }

AnalysisResult += {
  venueByItem?:     Record<activityId, VenueInfo>
  weather?:         WeatherNote            // null = no forecast data
  rideshareByItem?: Record<activityId, RideshareOption[]>
  enrichment?:      EnrichmentMeta
}
```

Invariants that the schema enforces (`.parse` rejects any violation):
- `provenance.verified` is the literal `false`. DayBridge never verifies a third-party claim.
- `notBooked` is the literal `true`. A deep link only opens the provider's app.
- Every `WeatherNote` has a concrete `date`. If no forecast covers that date, `weather` is `null`. The API never sends a "no rain" note without forecast data.
- `budgetMs` is at most 2500, the total cap in DECISIONS.md.
- When there is no data, omit the key. Map values are never `null`.

Rules the schema cannot check (reviewers check these):
- `pickupLabel` must contain `(demo)` when the pickup is the default demo point. Today that is `"Berkeley Civic Center (demo)"`.
- A fare's provenance is `{ source: "estimate", provider: "uber" }`. A link that has no fare carries the provenance of the coordinates it was built from, which is the venue's (`live`, `google-places`).
- `source: "live"` only for data actually fetched during this request. Use `"mock"` for canned or seeded values.

## UI labeling (Teammate A)

| Data | Required label |
|---|---|
| Any value with `source: "live"` | the provider plus the fetch time, e.g. "via Google Places · 11:00 AM" (`provider`, `fetchedAt`) |
| `source: "estimate"` | "Uber estimate · live", always shown with the currency |
| `source: "mock"` | the existing mock badge, never a "live" label |
| `accessibility.wheelchairEntrance` | a neutral **"unconfirmed"** chip, both for `true` and `false`. `null`/missing: show nothing |
| Every `RideshareOption` | **"Opens the app — not booked"**, plus the `pickupLabel` shown as-is |
| `weather === null` or missing | show nothing. Never fill in a "dry" or "no rain" state |
| `enrichment.timedOut` | optional quiet note "Some live details were skipped". The plan renders normally |

## Env flag and budget

- `DAYBRIDGE_ENRICH !== "1"` (the default and the rehearsed demo): the route returns the base result **without any enrichment keys**, and makes no network calls.
- `DAYBRIDGE_ENRICH === "1"`: all providers run in parallel under a single shared `AbortSignal`, with a total budget of at most 2500 ms. #11 uses `ENRICHMENT_BUDGET_MS = 1000`, which is within the cap.
  - Success: set `enrichment: { enabled: true, budgetMs, timedOut: false }` and include the fields that have data.
  - Budget hit or error: return the base plan, with `enrichment: { enabled: true, budgetMs, timedOut: true }`, no `venueByItem`/`rideshareByItem`, and `weather` omitted or `null`. Base `evidence` stays unchanged.
- Tests stub `fetch` (`vi.stubGlobal`). No test calls a real provider.

## Mapping from #11's current fields (at `41ed0a7`)

| #11 today (file) | Contract field | Change |
|---|---|---|
| `VenueInfo.name` (places.ts) | `VenueInfo.name` | same |
| `VenueInfo.address: string` | `address?` | same (now optional) |
| `VenueInfo.lat: number \| null` | `lat?` | omit instead of `null` |
| `VenueInfo.lon: number \| null` | `lng?` | **rename** `lon` → `lng`, and omit instead of `null` |
| `VenueInfo.stepFree: boolean \| null` | `accessibility.wheelchairEntrance` | **move/rename** |
| `VenueInfo.source: "google" \| "none"` | `provenance: { source: "live", provider: "google-places", fetchedAt, verified: false }` | **replace**. Drop `"none"` by omitting the venue |
| `venueByItem: Record<id, VenueInfo \| null>` | `Record<id, VenueInfo>` | **omit** null entries |
| `WeatherNote { summary, outdoorConcern } \| null` | `WeatherNote { date, summary, outdoorConcern?, provenance } \| null` | **add** `date` (the `occurrence` from `nextOccurrenceDate`) and `provenance: { live, "open-meteo" }` |
| `RideshareInfo { uberLink, lyftLink, estimate? } \| null` | `RideshareOption[]` (one entry per provider) | **reshape**: `[{ provider: "uber", deepLink: uberLink, … }, { provider: "lyft", deepLink: lyftLink, … }]`. Use `[]` or omit instead of `null` |
| `ORIGIN_LABEL` (rideshare.ts, not returned) | `pickupLabel` | **return** `"Berkeley Civic Center (demo)"` on every option |
| (absent) | `notBooked: true` | **add** |
| `estimate.fareLow / fareHigh / currency` | `fare.low / high / currency` (on the Uber option only) | **rename** |
| `estimate.source: "uber"` | `provenance: { source: "estimate", provider: "uber", fetchedAt, verified: false }` | **replace** |
| enrichment evidence `source: "google:places/accessibilityOptions"`, `verified: false` | `Evidence` (unchanged schema) | change `source` to `"google"` (DECISIONS.md condition 2). `verified: false` is already correct |
| route.ts `{ ...result, venueByItem, weather, rideshareByItem }` (outside the type) | the same fields on `AnalysisResult` | build `const result: AnalysisResult = { ...base, evidence, venueByItem, weather, rideshareByItem, enrichment }`, then `AnalysisResult.parse` it in the enrichment test |
| route.ts fallback `{ venueByItem: {}, weather: null, … }` | `enrichment.timedOut: true` | **add** `enrichment` meta. Omit empty maps |
| `ENRICHMENT_BUDGET_MS` (budget.ts) | `enrichment.budgetMs` | return the value |
| `calendarLink` (calendar.ts) | — | not part of this contract (still unused, see the review comment item 4) |
| `EventCandidate` (events.ts, `/api/integrations/events`) | — | a separate endpoint, out of scope. It already uses `verified: false` and `checkedAt` |

## Changes needed in #11 (owner: Teammate B)

1. places.ts: return `VenueInfo` with `lng`, `accessibility.wheelchairEntrance`, and `provenance` (`live`/`google-places`/`fetchedAt`/`verified: false`). Omit null venues.
2. places.ts: return `WeatherNote` with `date` (the occurrence) and `provenance` (`live`/`open-meteo`). Keep returning `null` when no forecast code matches the date.
3. rideshare.ts: return `RideshareOption[]` with `deepLink`, `pickupLabel` (contains "(demo)"), `notBooked: true`, and `fare {low, high, currency}` plus `estimate`/`uber` provenance when the Estimates API answered. Return `[]` instead of `null`.
4. places.ts evidence: `source: "google"`.
5. route.ts: put the fields on `AnalysisResult` and add `enrichment: { enabled, budgetMs, timedOut }`. With the flag off, the response stays the base result with no enrichment keys.
6. Test: with `DAYBRIDGE_ENRICH=1` and a stubbed `fetch`, `AnalysisResult.parse(await res.json())` passes. Add a timeout case where `timedOut` is `true`.
7. Delete `docs/integrations/SCHEMA_PROPOSAL.md`, or mark it superseded by this file. Its `EnrichmentSource` enum is replaced by `Provenance`.

Note: `/api/plans` (share) stores a parsed `AnalysisResult`, so once #11 adopts this contract, shared snapshots will include the enrichment fields. They contain no personal data: the pickup is the fixed demo point.
