# DayBridge Cloud: deploy and reliability runbook

Status: **NOT DEPLOYED.** Nothing here has been applied to a hosted Supabase project or to Vercel.
Every remote step is marked **[human approval required; not performed]** (see `CLAUDE.md`, "Deployment — CRITICAL").

**Scope: protected private preview only. Public hosting is NO-GO.** Per-user API rate limits exist (§9); CAPTCHA for
anonymous sign-ins is plumbed but not enabled, and there is no WAF. A preview is acceptable only behind Vercel Deployment Protection (password or SSO),
with Supabase's per-IP anonymous sign-in rate limit as the second layer.

## 1. Modes

| Mode | When | Coordination store | Auth | `/events` | Shares |
|---|---|---|---|---|---|
| Dev | `next dev`, no Supabase env | memory | none | open | memory |
| Local demo | `next start`, no Supabase env, `DAYBRIDGE_DEMO_EVENTS=1` | memory | none | open | memory only if `SHARE_STORE=memory`, else 503 |
| Prod, no Supabase | `NODE_ENV=production`, no Supabase env, flag unset | none: **503** (main's PR #22 behavior) | n/a | 503 | 503 |
| Cloud | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` set | Postgres via `coordination_create` / `coordination_commit` RPCs | `Authorization: Bearer <Supabase access token>`, else 401; foreign plan → 404 | **always 403 in production** (no key or flag opens it) | Postgres `share_snapshots` |

Response header `x-daybridge-persistence: memory | supabase` shows which store served a coordination request.
Consequence of the 403: in cloud production, plans stop at `PENDING_CONFIRMATION` (nothing can confirm dependencies).
Demo READY locally.

## 2. Local setup (Supabase CLI local stack)

```bash
npm install
supabase start                 # Docker; applies supabase/migrations/*.sql; API on :55321 (supabase/config.toml)
supabase status -o env         # copy API_URL / PUBLISHABLE_KEY / SECRET_KEY into .env.local (local keys only)
cp .env.example .env.local
npm run dev                    # /cloud for the signed-in flow
npx vitest run src/lib/supabase src/lib/share   # real local-DB tests (live suites skip when env unset)
# cross-process smoke: npm run build with the env above, two `next start -p 3101/3102`, then
SMOKE_STATE=/tmp/smoke.json node scripts/cloud-smoke.mjs http://127.0.0.1:3101 http://127.0.0.1:3102
# kill both servers, start one on 3101, then:
SMOKE_STATE=/tmp/smoke.json node scripts/cloud-smoke.mjs http://127.0.0.1:3101 reload
```

CI does exactly this in `.github/workflows/cloud-db.yml` (jobs `cloud-db-tests`, `cloud-smoke`; throwaway local Docker
stack, no hosted secrets). Never run `supabase link` / `supabase db push` against the hosted project without approval.

## 3. Environment variables (names only; values never committed)

| Name | Local | Vercel Production | Vercel Preview | Exposure |
|---|---|---|---|---|
| `SUPABASE_URL` | local stack URL (optional) | required | required (separate project/branch preferred) | server-only |
| `SUPABASE_SECRET_KEY` | local secret (optional) | required | required, **never the prod key** | **server-only secret**; never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SUPABASE_URL` | local URL | required | required | public (inlined at build) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | local publishable key | required | required | public by design (RLS protects data) |
| `DAYBRIDGE_DEMO_EVENTS` | `1` for local `next start` demo | **unset** | **unset** | server-only; cannot open `/events` when Supabase is set |
| `SHARE_STORE` | `memory` for local `next start` demo | **unset** | **unset** | server-only |
| `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` / `AI_TIMEOUT_MS` | optional | optional (unset = mock) | optional | server-only |

`DAYBRIDGE_DEMO_KEY` / `x-daybridge-demo-key` were removed; delete them from any environment that still has them.
`NEXT_PUBLIC_*` values are baked in at build time: changing them needs a rebuild.

## 4. Remote steps (each one: **[human approval required; not performed]**)

Supabase (target project; use a separate project/branch for Preview):
1. Back up, then apply migrations in order: `supabase/migrations/20261017000000_coordination.sql`,
   `supabase/migrations/20261017010000_shares.sql`, then `supabase/migrations/20261017020000_rate_limits.sql` (SQL editor, or `supabase link` + `supabase db push`).
2. Advisors → Security: no "RLS disabled" / "search_path mutable" findings for `coordination_*`, `share_snapshots` and `rate_limits`.
3. Authentication → Sign In / Providers: **enable Anonymous sign-ins**.
4. Authentication → Rate Limits: keep anonymous sign-ins low (local config: 30/hour/IP).
5. Later, before any public link (not needed for the protected preview): CAPTCHA, see §9 (needs a Turnstile widget
   that does not exist yet; the token plumbing does).
6. API keys: URL + publishable key (public) and a **secret** key (server-only) into Vercel env.

Vercel:
7. Set the §3 env vars per environment (Production and Preview separately; mark `SUPABASE_SECRET_KEY` Sensitive).
8. Settings → Deployment Protection: enable **Vercel Authentication (SSO) or Password Protection for all deployments,
   including Production**. This is the preview's access control.
9. Keep `vercel.json` `git.deploymentEnabled: false`; deploy is one manual `vercel deploy` by a human. Record the previous deployment for rollback.
10. Node.js runtime only (never `runtime = "edge"`); set the function region next to the Supabase region.

## 5. Rollback (also **[human approval required; not performed]**)

- **App:** Vercel → Deployments → promote the previous deployment. Or unset `SUPABASE_*` and redeploy: coordination and shares return 503 (fail closed).
- **Access:** keep Deployment Protection on; disabling Anonymous sign-ins stops new users immediately.
- **Database** (both migrations are additive; back up first, dropping loses all data):
  `drop function public.rate_limit_hit; drop table public.rate_limits;` (cloud writes then fail closed with 429: also unset or redeploy)
  `drop table public.share_snapshots;`
  `drop function public.coordination_commit, public.coordination_create, public.coordination_append; drop table public.coordination_seen_keys, public.coordination_events, public.coordination_plans;`
- **Keys:** rotate `SUPABASE_SECRET_KEY` and update Vercel env on any suspected exposure.

## 6. Evidence (what has actually been verified)

**Stubbed unit tests** (`npm test`, no database): `src/app/api/coordination/cloud.test.ts` — 401 on all routes, cross-user
404, accept→approve→execute→READY, scope-mismatch and unapproved-execute rejection, duplicate provider event, prod 503
without Supabase, prod `/events` 403 with Supabase, local `next start` demo mode, persistence header, cold-start reload,
two-instance CAS race. Share redaction/store tests in `src/lib/share/share.test.ts`.

**Real local DB tests** (`npx vitest run src/lib/supabase src/lib/share` against the local stack; CI job `cloud-db-tests`):
store CAS through the Postgres RPCs, RLS through a publishable-key client, and the share store with Supabase configured.

**Cross-process local smoke** (`scripts/cloud-smoke.mjs`; CI job `cloud-smoke`): two `next start` processes on one local
Supabase — 401 for missing/forged token, plan created on A loads on B, another user gets 404 on read and cancel, rejected
execute and scope mismatch, concurrent approvals across processes with a contiguous event log, execute →
`PENDING_CONFIRMATION`, production `/events` 403, plan survives a full server restart (`reload`).

**Hosted:** none. No hosted Supabase project or Vercel deployment has been exercised.

## 7. Open findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | No CAPTCHA on anonymous sign-in; only Supabase's per-IP rate limit. | Open → protected preview only |
| 2 | Medium | Per-user write limits now exist (§9), but anonymous sign-in mints new users cheaply, so per-user limits alone do not stop a scripted attacker. | Partly mitigated → CAPTCHA + WAF before public |
| 3 | Medium | `/events` always 403 in cloud production, so cloud plans never reach READY. | By design; demo READY locally |
| 4 | Medium (blocks live providers) | Dispatch is at-least-once; no auto-retry after dispatch (409 to the user). Needs a two-phase claim before any live provider. | Live providers stay disabled |
| 5 | Low | `execute` worst case ≈ 10s × actions; within Vercel's default limit; mock never hangs. | Accepted |
| 6 | Low | Preview runs `NODE_ENV=production`: without `SUPABASE_*` it returns 503 (by design). | Documented |

## 8. Recommendation

**GO only for a protected private preview**: Deployment Protection on, anonymous sign-ins enabled and rate-limited, both
migrations applied, Security Advisor clean, `npm run check` + `npm run build` + `cloud-db.yml` green on the exact commit.
**Public hosting: NO-GO** until CAPTCHA (finding 1) is enabled and a WAF/IP rate rule (finding 2) is in place.

## 9. Abuse controls

**Enforced in code (cloud mode = Supabase configured):**

| Control | Limit | Where |
|---|---|---|
| Per-user writes (any non-GET coordination request) | 60 / minute | `context()` in `src/app/api/coordination/_lib/service.ts` → 429 + `Retry-After` |
| Per-user plan creation (`POST /api/coordination/plans`, `/demo`) | 10 / hour | same |
| Plans per owner | 20 | `coordination_create` RPC (migration 20261017000000) |
| Event log per plan | 500 events | `MAX_LOG_EVENTS`, `src/domain/coordination/coordinator.ts` |
| Request body | 64 KB (coordination), 200 KB (share) | `parseBody` / `src/lib/share/share.ts` |
| Share snapshots | 1000 total, oldest evicted, expiring | `share_snapshot_create` RPC |
| Anonymous sign-ins | Supabase per-IP limit (local config 30/hour/IP) | Supabase Auth |

Limiter: `rateLimit(key, limit, windowSec)` in `src/lib/supabase/ratelimit.ts`, backed by the `rate_limit_hit` RPC
(migration 20261017020000): atomic fixed-window upsert counter in `public.rate_limits`, `security definer`,
`search_path=''`, execute granted to `service_role` only, RLS on with no policies and no grants to anon/authenticated,
~1% of hits prune finished windows. Windows follow the DB clock; `Retry-After` uses the server clock (advisory).
**Fails closed:** if the RPC errors the request gets 429 and the error is logged server-side, so an attacker cannot bypass
limits by stressing the limiter (if the DB is down the write would fail anyway). Without Supabase it uses an in-process
Map, but the local memory demo never calls it (no limits locally; `npm run demo:check` unchanged).
Tests: `src/lib/supabase/ratelimit.test.ts`, `src/app/api/coordination/ratelimit.test.ts` (no DB),
`src/lib/supabase/ratelimit.db.test.ts` (real local DB: concurrency exactness, rollover, key isolation, anon/authenticated denied).

**Not enforced:**
- CAPTCHA on anonymous sign-in: plumbing only. `src/lib/supabase/browser.ts` passes `options.captchaToken` to
  `signInAnonymously` when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set **and** the UI registers `setCaptchaTokenProvider(...)`.
  No widget ships, so today no token is sent.
- IP-level limits / bot protection on the API routes (Vercel WAF / Firewall rules).
- Read (GET) limits.

**Hosted steps — [human approval required; not performed]:**
1. Apply `supabase/migrations/20261017020000_rate_limits.sql`; Security Advisor clean for `rate_limits`.
2. CAPTCHA: create a Cloudflare Turnstile site → Supabase Authentication → Attack Protection → enable CAPTCHA,
   provider Turnstile, paste the **secret** → add a Turnstile widget that calls `setCaptchaTokenProvider` → set
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel (public, rebuild required). Enable CAPTCHA in Supabase only after the
   widget ships, or guest sign-in will fail.
3. Vercel → Firewall: add a rate-limit rule on `/api/*` per IP (e.g. 120/min) and keep Attack Challenge Mode available.
