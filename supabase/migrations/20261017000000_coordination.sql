-- DayBridge coordination persistence. Live, owner-only state machine (see docs/daybridge/PERSISTENCE_AUTH_PROPOSAL.md).
-- Every write goes through the server (service_role) via the two RPCs below; clients may only read their own rows.

create table public.coordination_plans (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  rev int not null default 1,
  plan jsonb not null,               -- full CoordinationPlan, validated by Zod on load
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coordination_plans_owner_id_idx on public.coordination_plans (owner_id);

create table public.coordination_events (
  plan_id uuid not null references public.coordination_plans(id) on delete cascade,
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

create table public.coordination_seen_keys (
  plan_id uuid not null references public.coordination_plans(id) on delete cascade,
  key text not null,
  primary key (plan_id, key)
);

alter table public.coordination_plans     enable row level security;
alter table public.coordination_events    enable row level security;
alter table public.coordination_seen_keys enable row level security;  -- no policies: server-only

create policy "owner reads plan" on public.coordination_plans
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner reads events" on public.coordination_events
  for select to authenticated using (exists (
    select 1 from public.coordination_plans p where p.id = plan_id and p.owner_id = (select auth.uid())));

revoke all on public.coordination_plans, public.coordination_events, public.coordination_seen_keys from anon;
revoke all on public.coordination_seen_keys from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.coordination_plans, public.coordination_events from authenticated;

-- Shared by both RPCs. Any failure (e.g. duplicate (plan_id, seq)) aborts the calling RPC's whole transaction.
create function public.coordination_append(p_id uuid, p_events jsonb, p_keys text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.coordination_events (plan_id, seq, at, type, actor, outcome, reason, idempotency_key, payload)
  select p_id, (e->>'seq')::int, (e->>'at')::timestamptz, e->>'type', e->>'actor', e->>'outcome',
         e->>'reason', e->>'idempotencyKey', coalesce(e->'payload', '{}'::jsonb)
    from pg_catalog.jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) e;
  insert into public.coordination_seen_keys (plan_id, key)
  select distinct p_id, k from pg_catalog.unnest(coalesce(p_keys, '{}'::text[])) k
  on conflict do nothing;
end $$;

-- Insert a new plan at rev 1 with its initial log and keys. Duplicate id raises (unique violation).
create function public.coordination_create(p_id uuid, p_owner uuid, p_plan jsonb, p_events jsonb, p_keys text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.coordination_plans (id, owner_id, rev, plan) values (p_id, p_owner, 1, p_plan);
  perform public.coordination_append(p_id, p_events, p_keys);
end $$;

-- Compare-and-swap: true if applied, false on rev mismatch / missing plan (nothing changed).
-- Concurrent callers with the same expected rev serialize on the row lock; the loser re-checks rev and gets false.
create function public.coordination_commit(p_id uuid, p_expected_rev int, p_plan jsonb, p_events jsonb, p_keys text[])
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.coordination_plans set plan = p_plan, rev = rev + 1, updated_at = pg_catalog.now()
   where id = p_id and rev = p_expected_rev;
  if not found then return false; end if;
  perform public.coordination_append(p_id, p_events, p_keys);
  return true;
end $$;

revoke execute on function public.coordination_append(uuid, jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.coordination_create(uuid, uuid, jsonb, jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.coordination_commit(uuid, int, jsonb, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.coordination_append(uuid, jsonb, text[]) to service_role;
grant execute on function public.coordination_create(uuid, uuid, jsonb, jsonb, text[]) to service_role;
grant execute on function public.coordination_commit(uuid, int, jsonb, jsonb, text[]) to service_role;
