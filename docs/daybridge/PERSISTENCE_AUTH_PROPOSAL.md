# Coordination persistence and auth: proposal

**Status: Proposed. Needs lead approval.** Nothing here is built or applied. The lead owns Supabase, secrets and deployment.

## 0. Where things stand
- `src/domain/coordination/coordinator.ts` keeps `Map<planId, { plan, log, seenKeys }>` inside `createCoordinator`, and `src/app/api/coordination/_lib/service.ts` caches that coordinator on `globalThis`. A restart wipes it. Each serverless instance gets its own copy, so plan ids are not shared between instances.
- `withLock` is a per-plan promise chain. It only serializes work **inside one process**.
- None of the routes check auth. Anyone who has a plan id can `GET` it, `POST .../commands` (approve, cancel, replan) and, outside production, `POST .../events`. `events` returns 403 in production unless `DAYBRIDGE_DEMO_EVENTS=1`.
- **Do NOT deploy the current state-changing endpoints (`/api/coordination/plans*`) on a public URL.** Keep them local, or put them behind section 3 first. Also never set `DAYBRIDGE_DEMO_EVENTS=1` on a public deploy.
- `plan.version` is the *replan* counter. It does not change on every write, so it cannot serve as a concurrency token. `updatedAt` is a timestamp, and two writes can carry the same one. This proposal adds a separate integer `rev`.

## 1. `CoordinationStore` port
```ts
// src/domain/coordination/store.ts (domain stays free of Supabase imports)
export type StoredPlan = { plan: CoordinationPlan; log: CoordinationEvent[]; seenKeys: Set<string>; rev: number };

export interface CoordinationStore {
  load(planId: string): Promise<StoredPlan | null>;
  /** Insert a new plan with rev = 1. */
  create(entry: Omit<StoredPlan, "rev">, ownerId: string | null): Promise<void>;
  /**
   * Atomic compare-and-swap: write the plan, append newEvents, add newKeys and set rev = expectedRev + 1,
   * but only while the stored rev still equals expectedRev. Returns false when another writer got there first.
   */
  commit(planId: string, expectedRev: number, plan: CoordinationPlan, newEvents: CoordinationEvent[], newKeys: string[]): Promise<boolean>;
}
```
How the engine uses it (a small change to `createCoordinator`, with `store` injected through `CoordinatorDeps`):
1. `load` → run the existing pure command/ingest logic on the loaded copy → `commit(id, rev, ...)`.
2. If `commit` returns `false`, reload and rerun, up to 3 attempts, then return `409 "Plan changed, retry"`. `CoordinationError` would need a 409 status added.
3. Keep `withLock` as well. It stops pointless CAS conflicts inside one instance. CAS is what keeps the data correct across instances.
4. **Provider dispatch inside a retried attempt:** dispatch runs under the same `idempotencyKey` (`planId:vN:kind:recipient`), so a retry is safe for any provider that honours the key, as the mock already does. The live `ProviderPort` must dedupe on that key too. A provider without key-based dedupe must never be wired in.

Implementations:
- **`createMemoryStore()`**: the default. It wraps today's Map, and `commit` compares a `rev` field in memory. All existing tests and the offline demo keep running unchanged.
- **`createSupabaseStore()`**: chosen in `service.ts` only when `SUPABASE_SECRET_KEY` (and `SUPABASE_URL`) are set. It uses `@supabase/supabase-js` with the secret key, server-side only. `commit` calls a single RPC so the three tables change in one transaction:

```sql
-- returns true if applied, false on rev mismatch
create function coordination_commit(p_id uuid, p_expected_rev int, p_plan jsonb, p_events jsonb, p_keys text[])
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update coordination_plans set plan = p_plan, rev = rev + 1, updated_at = now()
   where id = p_id and rev = p_expected_rev;
  if not found then return false; end if;
  insert into coordination_events (plan_id, seq, at, type, actor, outcome, reason, idempotency_key, payload)
  select p_id, (e->>'seq')::int, (e->>'at')::timestamptz, e->>'type', e->>'actor', e->>'outcome',
         e->>'reason', e->>'idempotencyKey', coalesce(e->'payload', '{}'::jsonb)
    from jsonb_array_elements(p_events) e;
  insert into coordination_seen_keys (plan_id, key) select p_id, unnest(p_keys) on conflict do nothing;
  return true;
end $$;
revoke execute on function coordination_commit from public, anon, authenticated;
```
The fallback is to skip the RPC and run a plain `update ... where id = $1 and rev = $2 returning rev`, followed by the inserts. That version is not atomic, but the `(plan_id, seq)` primary key still rejects a duplicate append. The RPC is preferred.

## 2. Migration sketch (`supabase/migrations/<ts>_coordination.sql`)
```sql
create table coordination_plans (
  id uuid primary key,
  owner_id uuid null references auth.users(id) on delete cascade,
  rev int not null default 1,
  plan jsonb not null,               -- full CoordinationPlan, validated by Zod on load
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table coordination_events (
  plan_id uuid not null references coordination_plans(id) on delete cascade,
  seq int not null,
  at timestamptz not null,
  type text not null,
  actor text not null,
  outcome text not null,
  reason text,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  primary key (plan_id, seq)
);
create table coordination_seen_keys (
  plan_id uuid not null references coordination_plans(id) on delete cascade,
  key text not null,
  primary key (plan_id, key)
);

alter table coordination_plans     enable row level security;
alter table coordination_events    enable row level security;
alter table coordination_seen_keys enable row level security;   -- no policies: server-only

create policy "owner reads plan"   on coordination_plans  for select to authenticated using (owner_id = auth.uid());
create policy "owner reads events" on coordination_events for select to authenticated
  using (exists (select 1 from coordination_plans p where p.id = plan_id and p.owner_id = auth.uid()));
-- No insert/update/delete policies: every write goes through the API routes with the secret key.
```
- The plan id is generated in the app (`crypto.randomUUID()`), so it needs no default.
- `load` validates `plan` with `CoordinationPlan.parse` and rebuilds the log from the event rows (the `reason`/`idempotency_key` columns map back to `reason`/`idempotencyKey`). Rows that fail validation return a 500, so a bad row is never trusted silently.

## 3. Minimum auth for any public deploy
- **Identity:** Supabase **anonymous sign-in** (one click, no form, keeps the demo frictionless). Magic link can come later. The browser uses only the publishable/anon key (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). These are public by design. `SUPABASE_SECRET_KEY` never takes a `NEXT_PUBLIC_` prefix.
- **Ownership:** `POST /api/coordination/plans` reads the bearer token, calls `supabase.auth.getUser(token)` on the server, and saves `owner_id`.
- **Commands and GET:** both require `owner_id === user.id`, else `404` (no hint that the plan exists). One helper, `requireOwner(req, planId)`, in `_lib/service.ts`.
- **Provider events:** stay disabled in production (the existing 403). Real provider callbacks would need their own route that verifies an **HMAC signature** over the raw body (`timingSafeEqual`, per-provider secret, timestamp within 5 min). Simulated events must never be accepted on a public URL.
- **Rate limit:** a per-plan and per-user cap on commands (for example 30/min). This can be a simple in-memory counter for the hackathon. Its ceiling is that each instance counts separately, so it is not shared across instances. Vercel Firewall rate-limit rules are the upgrade path. Mock dispatch costs nothing, but live dispatch means real invites and rides, so this cap is required before any live provider goes in.
- **Offline / no Supabase env:** auth is skipped and the memory store is used. That is only acceptable on localhost. The proposed guard: if `NODE_ENV === "production"` and there is no Supabase config, the coordination routes return 503.

## 4. Relationship to the lead's `plans` share table
| | `plans` (lead, Task 2) | `coordination_*` (this proposal) |
|---|---|---|
| Purpose | Read-only **snapshot** for `/plan/[id]` sharing | **Live** state machine: approvals, dispatch, events |
| Writes | One insert on "Save" | Every command/event, via CAS |
| Read access | Public by id (intentional) | Owner only |
| Mutable | No | Yes |

- Keep the two separate. A share link must never expose approval controls, contact details or the event log, and must never let anyone change live state.
- Optional link: `plans.coordination_id uuid null` (no FK requirement), so a shared snapshot can say "coordination in progress" without exposing it. Sharing a coordinated plan = insert a **redacted** snapshot (no contacts and no `idempotencyKey`s) into `plans`.
- **Offline UI:** the UI keeps calling the same `/api/coordination/*` routes, and the backend is the only thing that changes. When Supabase is not configured or unreachable, the server uses the memory store, so the local demo needs no network. The UI shows `dataSource` and a "saved"/"local only" badge. The response could carry a `persistence: "memory" | "supabase"` field: an additive contract change, which needs a contract-owner decision.

## 5. Decisions needed from the lead
- [ ] Approve a separate `coordination_*` schema vs folding it into `plans` (recommended: separate). **S**
- [ ] Approve the `coordination_commit` RPC (security definer, execute revoked from anon/authenticated) vs the non-atomic plain CAS. **S**
- [ ] Auth method: anonymous sign-in (recommended) or magic link; enable it in the Supabase project `bbvapuwrcvbrzqghwwyo`. **S**
- [ ] Env var names: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client); add them to `.env.example` (names only). **S**
- [ ] Is a public deploy of coordination in scope for judging at all? If not, keep it local-only and only the share table goes live (recommended for the hackathon). **S**
- [ ] If it is in scope: implement the store port, memory and Supabase stores, the retry loop and the 409 status. **M**
- [ ] If it is in scope: the `requireOwner` helper, a token-forwarding fetch wrapper in the UI, and the production 503 guard. **M**
- [ ] Rate limit: an in-memory counter (S) or Vercel Firewall rules (S, needs dashboard access).
- [ ] Contract: approve the additive `persistence` field and the `409` response in `COORDINATION_CONTRACT.md`. **S**
- [ ] Live providers stay out of scope until HMAC callbacks, idempotent dispatch and rate limits exist. Confirm. **S**
- [ ] Data retention: delete coordination rows after the event (contacts are personal data). **S**

Out of scope here: Realtime push of events (polling `GET` is enough), multi-user plans, and editing the share snapshot.
