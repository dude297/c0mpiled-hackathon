# DayBridge Cloud: deploy and reliability runbook

Status: **NOT DEPLOYED.** Nothing in this doc has been applied to the remote Supabase project or to Vercel.
Every remote step below needs explicit human approval (see `CLAUDE.md`, "Deployment — CRITICAL").

## 1. Modes

| Mode | When | Store | Auth | Header `x-daybridge-persistence` |
|---|---|---|---|---|
| Local / offline | `SUPABASE_URL` or `SUPABASE_SECRET_KEY` unset, `NODE_ENV != production` | in-memory (globalThis, lost on restart) | none | `memory` |
| Cloud | both set | Supabase Postgres via `coordination_create` / `coordination_commit` RPCs | `Authorization: Bearer <supabase access token>` required, else 401 | `supabase` |
| Misconfigured prod | Supabase unset, `NODE_ENV=production` | none | none | 503 on every coordination route (fail closed) |

## 2. Local setup (Supabase CLI local stack)

```bash
npm install
supabase start                 # Docker required; prints local API URL, publishable and secret keys
supabase db reset              # applies supabase/migrations/*.sql to the LOCAL db only
cp .env.example .env.local     # fill with the values `supabase status` prints (local keys only)
npm run dev                    # http://localhost:3000, /cloud for the signed-in flow
npm run check && npm run build
# cross-process smoke: build with the env above, run two `next start` servers, then
SMOKE_STATE=/tmp/smoke.json node scripts/cloud-smoke.mjs http://127.0.0.1:3101 http://127.0.0.1:3102
# restart the servers, then verify the plan survives:
SMOKE_STATE=/tmp/smoke.json node scripts/cloud-smoke.mjs http://127.0.0.1:3101 reload
```

`supabase/config.toml` already sets `enable_anonymous_sign_ins = true` and `anonymous_users = 30`/hour/IP for the local stack.
Never run `supabase link` / `supabase db push` against project `bbvapuwrcvbrzqghwwyo` without approval.

## 3. Environment variables

| Name | Local | Vercel Production | Vercel Preview | Exposure |
|---|---|---|---|---|
| `SUPABASE_URL` | local stack URL (optional) | required | required (prefer a separate/branch project) | server-only |
| `SUPABASE_SECRET_KEY` | local secret (optional) | required | required, **never the prod key** | **server-only secret**; never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SUPABASE_URL` | local URL | required | required | public (inlined into client bundle at build) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | local publishable key | required | required | public by design (RLS protects data) |
| `DAYBRIDGE_DEMO_EVENTS` | ignored (always on outside prod) | **unset** | `1` only if demoing callbacks | server-only |
| `DAYBRIDGE_DEMO_KEY` | ignored | unset (or random ≥32 chars if events enabled) | random ≥32 chars | **server-only secret** |
| `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` / `AI_TIMEOUT_MS` | optional | optional (unset = mock explanations) | optional | server-only |

`NEXT_PUBLIC_*` values are baked in at **build** time: changing them needs a rebuild, not just a redeploy of env.

## 4. Supabase dashboard steps (human approval required for each)

1. Authentication → Sign In / Providers → **enable Anonymous sign-ins**.
2. Authentication → Attack Protection: enable **CAPTCHA (Turnstile/hCaptcha)** before a public link goes out; anonymous sign-ins
   create real `auth.users` rows and are otherwise only rate-limited per IP (default 30/h). Keep the anonymous rate limit low.
   (CAPTCHA requires the client to pass a token to `signInAnonymously`; not implemented yet — see findings.)
3. Apply `supabase/migrations/20261017000000_coordination.sql` (SQL editor or `supabase db push` after `supabase link`).
4. Advisors → Security: confirm no "RLS disabled" / "function search_path mutable" warnings for the three `coordination_*` tables/functions.
5. API keys: copy URL + publishable key (public) and a **secret** key (server-only) into Vercel env. Rotate the secret key if it ever appears in a log, PR, or client bundle.
6. Optional: schedule cleanup of stale anonymous users (`auth.users where is_anonymous and created_at < now() - interval '30 days'`); plans cascade-delete.

## 5. Vercel notes (do not connect or deploy without approval)

- `vercel.json` keeps `git.deploymentEnabled: false`; deploys are manual (`vercel deploy` by a human).
- All coordination routes run on the **Node.js runtime** (default; supabase-js admin client + `crypto.timingSafeEqual`). Do not set `runtime = "edge"`.
- Region: set the function region to the Supabase project region (each command = 1 load + 1 RPC round trip; cross-region adds ~100ms+ per hop).
- Timeouts: `PROVIDER_TIMEOUT_MS = 10s` per action dispatch; `execute` dispatches every pending action sequentially and is
  never auto-retried after a dispatch (a lost CAS returns 409). Worst case ≈ 10s × actions (≈20s for 2 actions) plus DB latency.
  Vercel's default function limit (Fluid compute) covers this; if a plan sets a lower limit, add `export const maxDuration = 60` to the commands route.
  The mock provider never hangs, so this only matters for a live provider.
- Deployment Protection (Vercel Authentication) on Preview deployments is recommended so previews are not public.

## 6. Rollback plan

- **App:** Vercel → Deployments → promote the previous deployment (instant rollback); or unset `SUPABASE_*` env vars — production then returns 503 on coordination routes (fails closed) while the static demo UI stays up.
- **Demo events:** unset `DAYBRIDGE_DEMO_EVENTS` (takes effect on next request after redeploy of env) to shut the callback endpoint.
- **Database:** the migration is additive (3 new tables + 3 functions). Rollback SQL:
  `drop function public.coordination_commit, public.coordination_create, public.coordination_append; drop table public.coordination_seen_keys, public.coordination_events, public.coordination_plans;`
  Take a backup first; dropping loses all plans.
- **Keys:** rotate `SUPABASE_SECRET_KEY` in the dashboard and update Vercel env if exposure is suspected.

## 7. Audit findings

Route-level coverage: `src/app/api/coordination/cloud.test.ts` (12 tests, all passing against the real service, coordinator and
memory store with the same CAS contract): 401 on all four routes, cross-user 404 with no trace left, full accept→approve→execute→READY,
scope-mismatch and unapproved-execute rejection, duplicate provider event, prod 503, prod events gate (5 closed cases + open),
persistence header, cold-start reload from the store, and a two-instance CAS race (asserts CAS misses > 0 and a contiguous 1..n log).

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | Medium | Abuse | Anonymous sign-in has no CAPTCHA (`src/lib/supabase/browser.ts:21` calls `signInAnonymously()` without `captchaToken`); only the per-IP auth rate limit protects against mass user/plan creation. | Open: enable CAPTCHA + pass token, or keep the link private |
| 2 | Medium | Abuse / cost | No per-user API rate limit. Every command, including rejected ones, commits a row (`coordinator.ts:214-224` `mutate` always commits), and every request reloads the full event log. A signed-in user can grow their own plan's log without bound. | Open: acceptable for a private demo; add Vercel WAF rate limit before a public link |
| 3 | Medium | Demo flow | With `DAYBRIDGE_DEMO_EVENTS` unset (recommended in prod), nothing can confirm dependencies, so `/cloud` plans stop at `PENDING_CONFIRMATION` and never reach READY. `/cloud` (`src/app/cloud/page.tsx`) never posts events. | Expected; document in demo script, or demo READY locally |
| 4 | Medium (blocks live providers) | Reliability | Lead fix: an attempt that called a provider is never auto-retried; a lost CAS after dispatch returns 409 and the user retries `execute`, reusing the same `idempotencyKey` (test: "never re-runs provider dispatch automatically"). Dispatch is still at-least-once: before any live provider, add a two-phase claim (commit `dispatching` first, then call) and a provider that dedupes on the key. | Fixed for auto-retry; live providers stay disabled |
| 5 | Low | Timeouts | `execute` worst case ≈ 10s (`coordinator.ts:330`) × actions × 3 attempts. Within Vercel's default limit; mock never hangs. | Accepted |
| 6 | Low | Scale | `load` embeds all events/keys in one PostgREST select (`src/lib/supabase/store.ts`). If a project `max_rows` cap ever truncates embedded rows, the next commit would hit the `(plan_id, seq)` PK and the RPC aborts → 500 (fails closed, no corruption). | Accepted |
| 7 | Low | Memory | `locks` map (`coordinator.ts:86-88`) never drops entries; bounded by plans touched per warm instance. | Accepted |
| 8 | Low | Ops | Vercel Preview also runs with `NODE_ENV=production`: a preview without `SUPABASE_*` returns 503 on coordination routes (by design). Use a separate Supabase project/branch and secret for previews. | Documented |
| 9 | Info | Lint/tests | Transient lint error in `src/app/cloud/page.tsx` and a failing `auth.test.ts` case seen mid-integration (B's files). | Resolved: final `npm run check` green |

Verified OK (no finding):
- Serverless: correctness never depends on process memory in cloud mode. Coordinators are cached on `globalThis` only; state is reloaded per request and written by CAS (`rev`). Cold start test passes.
- AuthZ: all four routes call `context()` (auth) before body parsing; ownership enforced in the single `entry()` choke point (`coordinator.ts:206`); wrong owner and missing id both return the same 404; non-UUID ids short-circuit to 404; plan ids are `crypto.randomUUID()`.
- Events endpoint: production gate runs before auth; requires flag AND ≥32-char key AND timing-safe equal header; ownership still enforced after the gate.
- Duplicate provider events: `seenKeys` persisted in `coordination_seen_keys`, committed in the same transaction as the state change; duplicates return `duplicate`.
- Secrets: no `NEXT_PUBLIC_` misuse. Build with canary values: `SUPABASE_SECRET_KEY`/`DAYBRIDGE_DEMO_KEY` canaries absent from `.next/static` and prerendered HTML; no `service_role` string in client chunks (the only `sb_secret_` hit is supabase-js's key-prefix check).
- Stored data: `CoordinationPlan`/`CoordinationEvent` Zod-parsed on load; corrupt rows → generic 500, message logged server-side without tokens.
- Migration: RLS on all three tables; owner-only SELECT policies; anon fully revoked; authenticated has no write grants; `seen_keys` server-only; RPCs `security definer` with `search_path = ''`, EXECUTE revoked from public/anon/authenticated, granted to `service_role` only. Commit is a single-statement CAS + append in one transaction.

## 8. Recommendation

**GO for a private / link-shared demo deploy; NO-GO for a publicly advertised URL** until conditions 1-2 are met.

Conditions for GO (each needs human approval; nothing has been applied):
1. Migration applied to the target project and Security Advisor clean; anonymous sign-ins enabled.
2. Public link only after CAPTCHA (finding 1) and a Vercel WAF rate limit on `/api/coordination/*` (finding 2).
3. `SUPABASE_SECRET_KEY` and `DAYBRIDGE_DEMO_KEY` set as server-only env vars; `DAYBRIDGE_DEMO_EVENTS` unset in Production.
4. `npm run check` and `npm run build` green on the exact commit.
5. `vercel.json` `git.deploymentEnabled: false` unchanged; deploy is a manual, approved one-off; previous deployment noted for rollback.
