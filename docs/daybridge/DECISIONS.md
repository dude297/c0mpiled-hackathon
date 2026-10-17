# DayBridge: Decision Log

The lead's standing authorization (2026-10-17): the orchestrator (Claude Opus) may merge into `main` and approve anything that isn't a big technical decision. Big technical decisions are listed under **Needs lead decision** for review. Newest entries first.

## Needs lead decision
| # | Decision | Options | Orchestrator recommendation | Blocks |
|---|---|---|---|---|
| L1 | **Hosted deploy and data model:** persistence plus auth for `/api/coordination/*` (see `PERSISTENCE_AUTH_PROPOSAL.md`) | (a) local or single-instance demo only; (b) Supabase store, anonymous auth and owner checks | (a) for judging. Do (b) only if a hosted demo is required. The current endpoints change state with no auth, so **never deploy them publicly as-is** | any public deploy |
| L2 | **Live third-party data in `/api/analyze`** (Google Places, Open-Meteo, Uber fare API) | keep it key-gated and opt-in, or leave it out of the demo path | keep it, but behind an env flag and off by default in the rehearsed demo path; live calls are a demo-failure risk | `intg/third-party` merge |
| L3 | **Real outbound actions** (actual SMS, email, ride booking) | stay simulated / build a real `ProviderPort` adapter | stay simulated for the hackathon; the UI says "Simulated providers" | nothing |
| L4 | **Demo plan** (which profile and activities, local or hosted) | — | you said this will be finalized earlier; record the choice here | rehearsal |

## Approved by the orchestrator (non-big decisions)
| Date | Decision | Rationale |
|---|---|---|
| 2026-10-17 | Merge PR #1 (docs) → `main` | docs only; clean |
| 2026-10-17 | Merge PR #3 (coordination engine) → `main` after merging `main` into it and resolving the `docs/handoffs/README.md` conflict | lead approved; 140 coordination tests; check and build green |
| 2026-10-17 | Merge PR #4 (audit docs) → `main` | docs only; reassessment against #3 recorded in `INTEGRATION_STATUS.md`; GPT Work to follow up |
| 2026-10-17 | **Hold PR #2** until its tests call the real engine | 15/27 tests exercise a copied helper, not `engine.ts` |
| 2026-10-17 | Coordination screen is owned by the **UI teammate** (`src/app/coordinate/**`, `src/components/coordination/**`) | lead decision; Opus doesn't build UI |
| 2026-10-17 | **3-line `/api/analyze` change from `intg/third-party`: approved with conditions** | It's beneficial: venue, weather and rideshare links make the plan concrete, and they fail soft. As written it adds network latency (up to ~4 s) to every request, returns fields outside the schema with no live/mock label, and mixes unverified Google accessibility claims into the evidence as verified. **Conditions** (owner Teammate B, with the lead for `schema.ts`/route): (1) optional `venueByItem`/`weather`/`rideshareByItem` in `AnalysisResult`, each with `source: "live" \| "estimate" \| "mock"`; (2) enrichment evidence uses `verified: false` and `source: "google"`; (3) an env flag `DAYBRIDGE_ENRICH=1` plus a total 2.5 s budget, falling back to the base plan; (4) no network in tests (mock `fetch`) |
| 2026-10-17 | Contract change: `ActionScope.activityId` (required) | fixes a P0 false-READY across activities; additive for the UI because the UI echoes `action.scope` back unchanged |
| 2026-10-17 | GitHub is the durable agent queue; PR/issue comments name the owner and say whether they block | no second watcher; GPT Work owns monitoring infrastructure |
| 2026-10-17 | The orchestrator polls GitHub every 30 s and reviews new pushes with subagents | lead request |
