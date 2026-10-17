@AGENTS.md

<!-- DAYBRIDGE FINAL SPRINT PRIORITY -->
## DayBridge final sprint: parallel work, verified release

**Before taking new tasks, read `docs/daybridge/FINAL_SPRINT_DECISION_ADDENDUM.md` and `docs/daybridge/DECISIONS.md`.** The golden local demo is the required fallback; Supabase/auth/Vercel is an isolated experimental cloud lane, not a prerequisite for judging. PR #12 can enter the demo only if its complete golden-path checks pass. Attempt small confirm-before-apply intake in parallel and opt-in redacted read-only save/share only after privacy gates. Spawn non-overlapping subagents aggressively; protect a known-green release. No unapproved public deployment, real provider actions or cloud code merger.
<!-- END FINAL SPRINT PRIORITY -->


<!-- P0: CLAUDE/OPUS PARALLEL EXECUTION PRIORITY -->
## DayBridge Opus: Launch independent subagents aggressively

**Before implementation, read `docs/daybridge/OPUS_SUBAGENT_ADDENDUM.md`.** When the environment supports subagents, delegate independent coordination workstreams **early and concurrently**: state machine, approval policy, event/idempotency, API boundary, adversarial unit tests, and a read-only critical review. Freeze a minimal typed contract and assign **one owner per file** first. The primary Opus agent retains contract ownership, integration, tests, and PR responsibility. Do not let subagents edit UI, real-data/provider integrations, local AI, Supabase, GLM simulation, or GPT Work docs. If subagents are unavailable, report this rather than pretending to spawn them. Optimize for a verified offline P0 loop; no deployments or main pushes.

<!-- END:OPUS PARALLEL EXECUTION PRIORITY -->

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
