@AGENTS.md

# Project rules (c0mpiled-14)

## Deployment — CRITICAL
- Vercel deploy capacity is scarce. **Never deploy, never push, never connect Vercel/Netlify** without explicit approval.
- `vercel.json` sets `git.deploymentEnabled: false` — keep it. Deploys are manual and rare (one working version, then final release).
- Test locally: `npm run dev`, `npm run check`, `npm run build`.
- Once the demo works, cut a `release` branch and keep it stable.

## Engineering
- Deterministic logic for correctness-critical behavior lives in `src/domain/` (no AI calls there).
- AI (`src/lib/ai/adapter.ts`) explains/understands; it never fabricates results.
- Every result carries `dataSource: "mock" | "live"`; keep mock vs real integration visibly distinct.
- Zod schemas in `src/lib/schema.ts` are the contract between UI, API, domain, AI.
- Tests for key invariants/edge cases (`npm test`). End-to-end working demo before extras.
- No new infrastructure, auth, DB, or packages unless the demo needs it. No feature creep.
- Never commit secrets; server-only keys must not use the `NEXT_PUBLIC_` prefix.
