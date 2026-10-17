# Handoff: Teammate B, real data and the pitch

Read [README.md](README.md) first. Branch: `git checkout -b data/real-activities`.

## You own
- `src/domain/activities.ts`: the activity catalog (`ACTIVITIES`) and demo profiles (`DEMO_PROFILES`)
- The pitch: script, slides, demo video backup and rehearsal

Don't edit other code files. Tests in `src/domain/engine.test.ts` must still pass (`npm test`). If you change Margaret or Harold, tell Claude/the lead, because a couple of tests depend on Margaret being blocked from the choir.

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
