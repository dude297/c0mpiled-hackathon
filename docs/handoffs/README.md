# DayBridge: team handoffs

**DayBridge** turns an older adult's interests and real-life barriers (mobility, transport, schedule, budget, hearing, group size) into a weekly social plan they can actually follow. For each activity it shows what blocks it and how to work around the barrier.

**How it works:** Profile form → `POST /api/analyze` → Zod validation → deterministic barrier engine (`src/domain/engine.ts`) → AI explains the plan (it never invents results) → Plan, "Why not these?" and Evidence panels.

| Who | Owns | Handoff |
|---|---|---|
| Lead (repo owner) | Supabase + AI (save/share plans, plain-words intake, live model) | [lead-supabase-ai.md](lead-supabase-ai.md) |
| Teammate A | UI (all of `src/app/page.tsx`, `src/components/**`, styling) | [teammate-a-ui.md](teammate-a-ui.md) |
| Teammate B | Real activity data, demo profiles, pitch, rehearsal | [teammate-b-data-pitch.md](teammate-b-data-pitch.md) |
| Teammate C | Coordination UI (`/coordinate`: approvals, READY/replan, simulator, timeline) | [teammate-c-coordination-ui.md](teammate-c-coordination-ui.md) |
| Claude (with lead) | Engine, schema, API, tests, merges, demo reliability | — |

## Setup (everyone, about 5 minutes)
```bash
git clone https://github.com/dude297/c0mpiled-hackathon.git && cd c0mpiled-hackathon
git checkout main && npm install
cp .env.example .env.local      # works without editing; leave AI_BASE_URL blank for mock AI
npm run dev                     # http://localhost:3000, then click "Load demo: Margaret"
npm run check                   # typecheck + lint + tests; must pass before you hand anything off
```
Node 24 / npm 11. Next.js 16 has breaking changes; its docs are in `node_modules/next/dist/docs/`.

## Team rules
- **One owner per file.** Only edit the files listed in your handoff. If you need a change in someone else's file, ask them in chat.
- **Branch per person:** `ui/...`, `data/...`, `supa/...`. Merge into `main` through the lead after `npm run check` passes.
- **Never push to `main` or deploy.** Vercel deploys are scarce; the lead does one deploy at the end. `vercel.json` blocks auto-deploys, so keep it.
- **No new npm packages** without asking (Supabase's `@supabase/supabase-js` is pre-approved for the lead).
- **Never commit secrets.** Only `.env.example` is committed. Server-only keys must never use the `NEXT_PUBLIC_` prefix.
- **Mock vs live stays visible.** Every result has `dataSource: "mock" | "live"`, and the UI badge must stay.

## The contract (`src/lib/schema.ts`)
- `Profile`: name, interests[], mobility, transport[], maxTravelMin, times[], budgetPerWeek, hearingImpaired, prefersSmallGroups
- `AnalysisResult`: summary, items[] (stats), plan[] (`PlanItem`: name, when, travel, costPerWeek, score, barriers[]), blocked[] (name + hard barriers), evidence[] (`verified` = the check passed), explanation, dataSource
- `Barrier`: rule, `severity` (`hard` = blocks the activity, `soft` = workable with a `mitigation`)

Changing the schema? Tell the lead first, because it breaks other people's code.
