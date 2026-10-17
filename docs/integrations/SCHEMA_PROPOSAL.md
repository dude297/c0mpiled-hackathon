# Schema proposal for lead: typed integration enrichment fields (Issue #6, item 3)

From Teammate B, branch `intg/third-party`. The API currently returns `venueByItem` / `weather` /
`rideshareByItem` outside `AnalysisResult` with no mock/live provenance. Per the issue, adding these
is the lead's call — here is the exact additive diff to apply in `src/lib/schema.ts`:

```ts
// --- Integration enrichment (additive; nothing existing changes) ---

export const EnrichmentSource = z.enum(["google:places", "open-meteo", "uber", "none"]);
export type EnrichmentSource = z.infer<typeof EnrichmentSource>;

export const VenueInfo = z.object({
  name: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  stepFree: z.boolean().nullable(), // crowd-sourced; never treat as verified
  source: EnrichmentSource,
});
export type VenueInfo = z.infer<typeof VenueInfo>;

export const WeatherNote = z.object({
  summary: z.string(),
  outdoorConcern: z.boolean(),
  source: EnrichmentSource, // "open-meteo"
});
export type WeatherNote = z.infer<typeof WeatherNote>;

export const FareEstimate = z.object({
  fareLow: z.number(),
  fareHigh: z.number(),
  currency: z.string(),
  source: EnrichmentSource, // "uber"
});
export type FareEstimate = z.infer<typeof FareEstimate>;

export const RideshareInfo = z.object({
  uberLink: z.string(),
  lyftLink: z.string(),
  estimate: FareEstimate.nullable().optional(),
});
export type RideshareInfo = z.infer<typeof RideshareInfo>;
```

Then extend the analyze response (either as additive fields on `AnalysisResult`, or a wrapper the
route returns — the lead picks the shape):

```ts
export const Enrichment = z.object({
  venueByItem: z.record(z.string(), VenueInfo.nullable()),
  weather: WeatherNote.nullable(),
  rideshareByItem: z.record(z.string(), RideshareInfo.nullable()),
});
```

UI side (mine, no schema dependency needed to render): plan cards already show the address with a
"via Google" label and the mock/live badge covers provenance. Once the lead merges the typed
envelope, the UI can switch to parsing `Enrichment` instead of the loose shape.

Sources/badges to render: `google:places` → "live: Google", `open-meteo` → "live: Open-Meteo",
`uber` → "live: Uber estimates". Absent keys → base plan only, badge unchanged.
