# Handoff: Teammate B — Real Data, Third-Party Integrations & Demo

Read [README.md](README.md) first. Branch: `git checkout -b data/real-activities`.

## You own
- `src/domain/activities.ts`: the activity catalog (`ACTIVITIES`) and demo profiles (`DEMO_PROFILES`).
- **External integrations:** `src/integrations/**`, including source normalization, a read-only provider connector, mapping/calendar handoff utilities, and (only after contract approval) sandbox-capable email/invite/ride adapters.
- Optional dedicated integration API handlers under `src/app/api/integrations/**`, coordinated with Opus's typed contract and the lead.
- `docs/handoffs/teammate-b-integrations.md`: setup, provider research, data provenance, mock/live limits, demo/fallback instructions.
- The pitch: script, slides, demo video backup and rehearsal.

**Do not edit** Teammate A's UI; Opus's `src/domain/coordination/**`, `src/app/api/coordination/**`, or `src/lib/schema.ts`; GLM's `src/simulation/**`; or the lead's `src/lib/ai/**`, `src/app/api/plans/**`, `src/app/api/intake/**`, Supabase files and secrets. Request required changes from each owner. Tests in `src/domain/engine.test.ts` must still pass (`npm test`). If you change Margaret or Harold, tell Claude/the lead, because tests may depend on specific blockers.

## Task 1: Real activities (P1, start now)
Replace the 10 made-up activities with **10–15 real local ones** (Berkeley/East Bay, or wherever the demo is set): senior centers, library programs, parks & rec, faith communities, volunteer shifts. Each needs:

```ts
{ id: "short-slug", name: "Real Program Name", tags: ["music"],   // from the Interest enum in schema.ts
  day: "Tue", time: "afternoon", costPerWeek: 0,
  travelMin: { drive: 10, bus: 25, paratransit: 30, family: 10, walk: 20 },  // omit modes that aren't practical
  stepFree: true, groupSize: "small", noisy: false, hearingLoop: false }
```
- Keep a source link for each one in a code comment.
- Estimate travel times from one demo home address (pick one and write it in a comment), using Google Maps transit/drive times.
- Unknown accessibility details: make a reasonable guess and mark it `// est.`
- **The data must create interesting conflicts.** Include some popular activities that are blocked for a realistic reason (stairs, evening only, too far by bus, cost), so the "Why not these?" panel has something to say.

## Task 2: Demo profiles (P1)
Keep `margaret` and `harold` (or rename them) so each shows a clear story:
- **Margaret:** walker, no car. She loves choir, but it has stairs; DayBridge finds two things she *can* do, with workarounds.
- **Harold:** cane, paratransit, wants evenings. He's blocked mostly by transport.
Run each one in the app (`npm run dev`) and check that the plan makes sense to a non-technical person.

## Task 3: Pitch (P1)
- 2-minute script: problem (isolation and loneliness in older adults; find one credible statistic and cite it) → "the barrier isn't motivation, it's logistics" → live demo (Margaret) → "Why not these?" → AI explanation running **on-device via RunAnywhere** (private health/mobility data never leaves the laptop) → saved plan shared with family (Supabase) → what's next.
- 3–5 slides max. The demo itself is the main event.
- Record a backup screen video of the demo once the UI is polished, in case the live demo fails.

## Task 4: Rehearsal (P2)
Once the UI and Supabase features are merged, run the full demo from a fresh browser 3 times. Note anything slow, confusing or broken, and send the list to the lead.

## Task 5: Third-party integration ownership (P0/P1)

Your job is the **connection to the real world**, not the coordination state machine. Prioritize an authentic, inspectable integration with an offline fallback.

### P0 — integration that works without special authorization
1. **Real activity provenance:** add official source URLs, citation/last-checked metadata, and trustworthy venue/program facts to `src/domain/activities.ts` without inventing current seats, hours, accessibility, live availability, prices, or travel times. Mark estimates explicitly. Check with Opus before changing shared types.
2. **One working read-only third-party connection:** choose one low-friction option that can be completed and demonstrated reliably (e.g. a public event/program data source, or Google Maps directions deeplinks for a selected real venue). Make the connection meaningful and label external links versus verified live API data. Do not describe a mere outbound link as a two-way API integration.
3. **Calendar handoff:** provide an add-to-calendar flow using a valid iCalendar (`.ics`) event or documented calendar deeplink for an approved plan. Do not claim the event was inserted into a person's calendar without confirmation.
4. **Fallback:** retain local cached demo-safe examples with a timestamp and `dataSource: "mock" | "live"` or equivalent provenance. Demonstrate that an offline/nonresponsive provider never makes DayBridge claim `READY`.

### P1 — only after the core demo works and Opus freezes ProviderPort
5. Build exactly one **sandbox-only or consent-gated** invitation / messaging integration (e.g. an approved email provider) behind Opus's `ProviderPort` contract; coordinate contract and provider interfaces with Opus before writing the bridge. A successful send is not RSVP acceptance. Real recipients, rides, bookings, and spending require explicit user approval scoped to recipient, payload, action and time. Never make real outbound calls in the default demo.
6. Transport integration may discover a ride option or open an external service for manual continuation. Do not fabricate booking confirmations or automate payment; ride confirmation must come from an explicit provider event.
7. Work with Teammate A to wire new API responses via an interface request, not direct edits. Work with GLM to supply redacted provider fixtures/test cases without changing GLM-owned code. The lead retains Supabase, local AI, all credentials and deployment decisions.

### Definition of done
- A real, verifiable activity source and one working external handoff/API path, with a corresponding offline fallback and clear mock/live attribution.
- Integration contract and setup guide under `docs/handoffs/teammate-b-integrations.md`.
- `npm run check` and `npm run build` pass locally; include specific evidence in your PR.
- No secret in code, unauthorized send, outside booking, auto-deploy, or direct push to `main`.
- Demo story includes what actually connects externally and what is simulated, with a graceful failure sequence. No claim of local inference or external confirmation without proof.

### Timeboxing
Finish verified activity data plus one read-only integration before attempting provider OAuth, paid APIs, email delivery, calendar write access, or transportation booking. Maintain the current 2-minute pitch and 4–5-minute full walkthrough regardless of integrations.
