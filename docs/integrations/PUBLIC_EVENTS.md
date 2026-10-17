# Live public event discovery

`GET /api/integrations/events` now retrieves real upcoming events from UC Berkeley's official public calendar. No API key, account, feature flag, or user profile is required. The existing seeded planner remains separate until schema/engine and UI owners integrate discovery.

## Source

- Official calendar: https://events.berkeley.edu/
- Fixed JSON feed: https://events.berkeley.edu/live/json/events/max/100/hide_repeats/true/response_fields/location,tags,summary
- Provider API documentation: https://support.livewhale.com/calendar-onboarding/widgets-and-api/

The exact feed was downloaded successfully on October 17, 2026. Its actual payload was passed through the production parser and route in a one-time offline probe (using the downloaded response), returning real listings. Regular tests use only synthetic fixtures and make no external calls.

## Contract for Sparsh

Response: `{status: "live" | "unavailable", events: EventCandidate[], sourceUrl, checkedAt}`.

Each candidate includes `id`, `name`, official `url`, `startsAt`, nullable `endsAt`, `allDay`, nullable `location`, `proximity`, `tags`, `source: "uc-berkeley"`, `verified: false`, `checkedAt`, `accessibility: "unknown"`, `cost: "unknown"`, `eligibility: "check-source"`.

Display under a real-events discovery section, with original link and provider attribution. Render strings as text, never innerHTML. The endpoint returns only coordinate-backed locations within 20 km of Berkeley. Unknown-location events and known distant away games are excluded from the endpoint; the pure parser retains unknown locations for future review. Calendar inclusion does not establish public eligibility: some events require tickets, registration, membership or affiliation. The source link is the place to check. Do not call an event free or accessible without evidence.

On provider failure show unavailable, not invented/mock listings labeled live. A successful empty list is distinct from unavailable.

## Operation and privacy

Requests go only to the fixed public feed and include no personal data, credentials, cookies or referrer. The source sees normal server connection metadata. Five-minute per-process caching and coalescing prevent a source request per visitor. Fetch has a five-second timeout, no redirects and a streamed 2 MB limit. No registrations, messages, payment or bookings occur.

Results are limited to the first 100 source entries, not a comprehensive city-wide feed. Public calendar listing facts remain provider-reported. Hard feasibility attributes and travel duration remain unknown. The engine/schema owner must define unknown handling before feeding these into `runScenario`; this patch does not fabricate Activity fields or modify another owner's engine/UI.

## Verification

`npm run check` passed before the route test addition (203 tests); final verification is recorded in the task response. A live feed download succeeded. The real-payload probe passed. The existing Turbopack production-build port restriction remains an environment limitation; no deploy occurred.

## Automatic updates

`GET /api/integrations/events/live` is a server-sent event stream. It sends an initial discovery snapshot and checks every 60 seconds while connected. The upstream five-minute cache remains in effect; updates are not instant provider push notifications. Disconnecting stops the polling timer. Reconnection is requested after five seconds.

UI-owner wiring:

```ts
const stream = new EventSource("/api/integrations/events/live");
stream.addEventListener("events", (event) => {
  const snapshot = JSON.parse((event as MessageEvent).data);
  // Replace discovery cards and show snapshot.checkedAt / status.
});
// React effect cleanup:
// return () => stream.close();
```

The stream accepts no personal profile and forwards no user data to the public source. Only events with provider coordinates within the local radius are exposed by discovery. This backend stream is implemented; UI subscription is still the UI owner's integration step.

## Free maps and directions (no key)

Every coordinate-backed event now includes `mapLink` and `directionsLink`, constructed from the existing source coordinates via Google Maps URLs. Neither Google Places nor an API key is needed for these links. No lookup is made when building or returning them. `origin` is deliberately omitted so the app doesn't send a user's home/profile location; the user chooses the start point in Google Maps. Unknown coordinates yield null links, never guessed destinations.

UI owner: use `mapLink` for **Open in Google Maps**, and `directionsLink` for **Get directions**. These open another service when the user clicks; they do not verify accessibility, travel time or a booking. Existing Google Places and fare estimation remain optional and are not required for this event discovery path.

Official URL documentation: https://developers.google.com/maps/documentation/urls/get-started
