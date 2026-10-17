# Handoff: c0mpiled-14 hackathon starter

Written 2026-10-17 (the night before the event). Everything below reflects what actually exists in the repo.

## 1. Location
- Local dir: `C:\Users\YC\Downloads\ucb` (Windows 11, Node 24.15.0, npm 11.16.0; pnpm not installed)
- Remote: `https://github.com/dude297/c0mpiled-hackathon.git` (`origin`). **Remote is empty — nothing pushed yet.**

## 2. Stack / packages (exact installed versions)
- next 16.4.2 (App Router, `src/` dir), react / react-dom 19.3.0, typescript 5.9.3
- tailwindcss 4.3.3 + @tailwindcss/turbopack, tw-animate-css
- shadcn 4.22.0 (style `base-nova`, built on @base-ui/react 1.9.0; `cn` util from the `cn` package by shadcn-ui), lucide-react, class-variance-authority
- zod 4.6.7, vitest 5.0.5, eslint 9 + eslint-config-next
- Note: Next 16 has breaking changes vs older versions. Docs ship in `node_modules/next/dist/docs/`. `next.config.ts` has `cacheComponents: true` (from the template).
- Not installed on purpose: no DB client, no auth, no Stripe, no AI SDK.

## 3. Architecture
Flow: **Scenario input (UI) → POST /api/analyze → Zod validation → deterministic domain engine → AI adapter explains → Result + Evidence panels**

```
src/
  app/
    layout.tsx                  root layout
    page.tsx                    client page: wires the panels and calls /api/analyze
    api/analyze/route.ts        POST handler (validate → runScenario → ai.explain)
    api/analyze/route.test.ts   vitest: determinism, schema-valid output, 400s on bad input
  components/
    ui/                         shadcn: button, card, textarea, badge
    dashboard/panels.tsx        DashboardShell, ScenarioPanel, ResultPanel, EvidencePanel
  domain/engine.ts              runScenario(): PLACEHOLDER deterministic logic (word/sentence stats)
  lib/
    schema.ts                   Zod: ScenarioInput, Evidence, AnalysisResult (with dataSource: mock|live)
    ai/adapter.ts               AiAdapter interface + mockAdapter; getAiAdapter() returns the mock
    utils.ts                    cn()
vercel.json                     git.deploymentEnabled=false
vitest.config.mts               "@" alias → src
```

## 4. Files created/modified
Created by the scaffold (create-next-app + shadcn init/add): package.json, package-lock.json, tsconfig.json, next.config.ts, eslint.config.mjs, components.json, AGENTS.md, src/app/{layout.tsx,globals.css,favicon.ico}, src/components/ui/*, src/lib/utils.ts.
Written/edited by hand: src/app/page.tsx, src/app/api/analyze/{route.ts,route.test.ts}, src/components/dashboard/panels.tsx, src/domain/engine.ts, src/lib/schema.ts, src/lib/ai/adapter.ts, vitest.config.mts, vercel.json, .gitignore (allows `.env.example`), .env.example, CLAUDE.md, this file. Layout metadata title changed. Default public/*.svg and README.md removed.

## 5. Commands
```
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # next typegen && tsc --noEmit (typegen is needed for LayoutProps types)
npm run lint
npm test             # vitest run
npm run check        # typecheck + lint + test
npm run build        # local production build (does NOT deploy)
```

## 6. Verified results (2026-10-17)
- `npm install`: OK (one npm warning about the unrs-resolver postinstall not being in allowScripts; lint works anyway)
- typecheck: pass. lint: pass, 0 problems. tests: 5/5 pass.
- `npm run build`: pass. Routes: `/` static, `/api/analyze` dynamic.
- Dev server smoke test: `GET /` → 200 and renders the dashboard. `POST /api/analyze {"prompt":"Plan a visit. Check transport."}` → 200 with summary, items, 2 verified evidence items, mock explanation, `dataSource:"mock"`. `POST {}` → 400 with an error message.
- Fixed during setup: vitest peer conflict (bumped @types/node to ^24), missing `LayoutProps` type (added `next typegen` to typecheck), and the vitest config ESM warning (renamed it to `.mts`).

## 7. Git
- Branch `main`. Code commit `cf31fd4` ("Generic hackathon starter..."). CLAUDE.md and this handoff were committed after that. Run `git log --oneline` for the current state.
- Nothing pushed. `.env.local` is gitignored.

## 8. Deployment and auto-deploy risks
- GitHub repo has no webhooks (`gh api .../hooks` → `[]`). The repo is public, and the account has admin rights.
- No Vercel project is linked to this repo (Vercel API, default scope). No `.vercel/` dir, no `.github/workflows`, no Netlify config.
- `vercel.json` sets `git.deploymentEnabled: false`. If someone imports the repo into Vercel later, pushes still won't auto-deploy. Deploy manually with `vercel` / `vercel --prod` only when approved.
- Risk: the Vercel GitHub App could be installed account-wide. I couldn't verify that (the installation API needs app auth). The vercel.json guard covers this case.
- Plan: test locally, then do 1 hosted deploy of a working version, then the final release. Keep the rest of the capacity for emergencies.

## 9. Env vars (names only; see .env.example)
- `AI_API_KEY`: server-only. Not used yet; it's for a future live adapter.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: optional. Supabase is NOT wired up. A project exists (ref `bbvapuwrcvbrzqghwwyo`).

## 10. Candidate ideas and pivot strategy
1. **DayBridge / Unlock (primary):** AI for older adults that learns preferences, identifies barriers to social activities, and creates feasible participation plans.
2. **AskFirst (fallback):** AI decision engine using expected value of information and optimization.
3. **GhostProtocol (alternative):** detects behavioral API regressions and verifies customer-specific code repairs.

Pivot = swap three files, keep everything else:
- `src/domain/engine.ts`: real deterministic logic (DayBridge: constraint/feasibility scoring of barriers vs. activities; AskFirst: EVOI computation + optimizer; GhostProtocol: diff old vs. new API responses + run repair checks).
- `src/lib/schema.ts`: add domain fields to ScenarioInput and keep the AnalysisResult shape. Evidence = barrier checks / EVOI terms / regression test outcomes.
- `src/lib/ai/adapter.ts`: add a live adapter (server-side, structured output, timeout, fallback to the mock).
UI panels are generic: Scenario / Result / Evidence. Just relabel them.

## 11. Priorities and restrictions
- Deterministic logic for correctness. AI only understands and explains; it never fabricates results.
- Mock vs. live is always labeled (`dataSource` badge in the UI).
- Tests for key invariants. Get a working end-to-end demo before adding extras. No new infrastructure, auth, or DB unless the demo needs it. No feature creep.
- NO deploys, NO pushes, NO Vercel/Netlify connections without explicit approval. Don't touch hosting settings.

## 12. Next steps once the idea is chosen
1. `git checkout -b feat/<idea>`. Run `npm run dev` and `npm run check` to confirm the baseline.
2. Define the input/output Zod schema in `src/lib/schema.ts`.
3. Implement the deterministic core in `src/domain/` plus tests for its invariants and edge cases.
4. Update the ScenarioPanel inputs and add a seeded demo scenario button (known-good data).
5. Add the live AI adapter (explanations only; fall back to the mock on error or timeout).
6. Rehearse the full flow locally. Run `npm run build`. Merge to `main`, then create the `release` branch.
7. Only then, with approval: push and do **one** manual deploy.
