-- DayBridge caregiver dashboard persistence (docs/daybridge/CAREGIVER_DASHBOARD_CONTRACT.md).
-- Authority comes ONLY from caregiver_grants. Every write goes through the server (service_role); clients may
-- only SELECT what an active grant (or being the person themselves) allows. Invariants live in the RPCs below.

create table public.caregiver_people (
  person_id uuid primary key,
  profile jsonb not null,                 -- Profile, Zod-validated on read
  timezone text not null,
  self_user_id uuid references auth.users(id) on delete set null,
  check_in_schedule jsonb,                -- { everyDays } | null
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index caregiver_people_self_user_id_idx on public.caregiver_people (self_user_id);

-- user_id deliberately has no FK: a grant may name a user id before that user exists; it confers nothing until they sign in.
create table public.caregiver_grants (
  person_id uuid not null references public.caregiver_people(person_id) on delete cascade,
  user_id uuid not null,
  scopes text[] not null check (cardinality(scopes) > 0 and scopes <@ array['view', 'checkin', 'manage']::text[]),
  granted_by uuid not null,
  granted_at timestamptz not null,
  revoked_at timestamptz,
  primary key (person_id, user_id)
);
create index caregiver_grants_user_id_idx on public.caregiver_grants (user_id);

create table public.caregiver_plan_links (
  plan_id uuid primary key references public.coordination_plans(id) on delete cascade,  -- one plan, one person
  person_id uuid not null references public.caregiver_people(person_id) on delete cascade,
  linked_at timestamptz not null,
  linked_by uuid not null
);
create index caregiver_plan_links_person_id_idx on public.caregiver_plan_links (person_id);

create table public.caregiver_checkins (
  check_in_id uuid primary key,
  person_id uuid not null references public.caregiver_people(person_id) on delete cascade,
  kind text not null check (kind in ('ok', 'call', 'help')),
  plan_id uuid,
  note text check (note is null or char_length(note) between 1 and 280),
  reporter_user_id uuid not null,
  reporter_role text not null check (reporter_role in ('self', 'caregiver')),
  source text not null check (source in ('app', 'demo')),
  at timestamptz not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (person_id, reporter_user_id, idempotency_key)
);

create table public.caregiver_acks (
  person_id uuid not null references public.caregiver_people(person_id) on delete cascade,
  user_id uuid not null,
  item_id text not null,
  at timestamptz not null,
  primary key (person_id, user_id, item_id)
);

-- RLS helper. Security definer so the grants policy can consult grants without recursing into its own RLS.
create function public.caregiver_has_grant(p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.caregiver_grants g
                  where g.person_id = p_person and g.user_id = (select auth.uid()) and g.revoked_at is null)
$$;
revoke execute on function public.caregiver_has_grant(uuid) from public, anon;
grant execute on function public.caregiver_has_grant(uuid) to authenticated, service_role;

alter table public.caregiver_people     enable row level security;
alter table public.caregiver_grants     enable row level security;
alter table public.caregiver_plan_links enable row level security;
alter table public.caregiver_checkins   enable row level security;
alter table public.caregiver_acks       enable row level security;

create policy "grantee or self reads person" on public.caregiver_people for select to authenticated
  using (public.caregiver_has_grant(person_id) or self_user_id = (select auth.uid()));
create policy "grantee reads grants" on public.caregiver_grants for select to authenticated
  using (public.caregiver_has_grant(person_id));
create policy "grantee reads plan links" on public.caregiver_plan_links for select to authenticated
  using (public.caregiver_has_grant(person_id));
create policy "grantee reads checkins" on public.caregiver_checkins for select to authenticated
  using (public.caregiver_has_grant(person_id));
create policy "own acks" on public.caregiver_acks for select to authenticated
  using (user_id = (select auth.uid()));

-- revoke all (not a privilege list): Supabase's default grants include PG17's MAINTAIN.
revoke all on public.caregiver_people, public.caregiver_grants, public.caregiver_plan_links,
              public.caregiver_checkins, public.caregiver_acks from public, anon, authenticated;
grant select on public.caregiver_people, public.caregiver_grants, public.caregiver_plan_links, public.caregiver_acks to authenticated;
-- Notes are visible only to the reporter and managers (canSeeNote); the server applies that, so clients never get the column.
grant select (check_in_id, person_id, kind, plan_id, reporter_user_id, reporter_role, source, at, idempotency_key, created_at)
  on public.caregiver_checkins to authenticated;

-- Person + creator's grant in one transaction.
create function public.caregiver_create_person(p_person_id uuid, p_profile jsonb, p_timezone text, p_self_user_id uuid,
  p_check_in_schedule jsonb, p_created_at timestamptz, p_created_by uuid, p_scopes text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.caregiver_people (person_id, profile, timezone, self_user_id, check_in_schedule, created_at, created_by)
  values (p_person_id, p_profile, p_timezone, p_self_user_id, p_check_in_schedule, p_created_at, p_created_by);
  insert into public.caregiver_grants (person_id, user_id, scopes, granted_by, granted_at)
  values (p_person_id, p_created_by, p_scopes, p_created_by, p_created_at);
end $$;

-- Is anyone other than p_user an active manager? Callers hold the person row lock.
create function public.caregiver_other_managers(p_person uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.caregiver_grants g where g.person_id = p_person and g.user_id <> p_user
                  and g.revoked_at is null and 'manage' = any (g.scopes))
$$;

-- Replace scopes (re-activating a revoked grant). 'last_manager' if it would leave no active manager.
-- The person row lock serializes every grant change for that person.
create function public.caregiver_upsert_grant(p_person uuid, p_user uuid, p_scopes text[], p_granted_by uuid, p_granted_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare prev public.caregiver_grants;
begin
  perform 1 from public.caregiver_people where person_id = p_person for update;
  if not found then return 'not_found'; end if;
  select * into prev from public.caregiver_grants where person_id = p_person and user_id = p_user;
  if found and prev.revoked_at is null and 'manage' = any (prev.scopes) and not ('manage' = any (p_scopes))
     and not public.caregiver_other_managers(p_person, p_user) then
    return 'last_manager';
  end if;
  insert into public.caregiver_grants (person_id, user_id, scopes, granted_by, granted_at)
  values (p_person, p_user, p_scopes, p_granted_by, p_granted_at)
  on conflict (person_id, user_id) do update
    set scopes = excluded.scopes, granted_by = excluded.granted_by, granted_at = excluded.granted_at, revoked_at = null;
  return 'ok';
end $$;

create function public.caregiver_revoke_grant(p_person uuid, p_user uuid, p_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare prev public.caregiver_grants;
begin
  perform 1 from public.caregiver_people where person_id = p_person for update;
  if not found then return 'not_found'; end if;
  select * into prev from public.caregiver_grants where person_id = p_person and user_id = p_user and revoked_at is null;
  if not found then return 'not_found'; end if;
  if 'manage' = any (prev.scopes) and not public.caregiver_other_managers(p_person, p_user) then return 'last_manager'; end if;
  update public.caregiver_grants set revoked_at = p_at where person_id = p_person and user_id = p_user;
  return 'revoked';
end $$;

-- Idempotent on (person, reporter, key). Concurrent duplicates: ON CONFLICT waits for the first insert to commit,
-- then this statement's successor sees it. Same key + different body → conflict (stored row returned, nothing changed).
create function public.caregiver_record_checkin(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare row public.caregiver_checkins;
begin
  insert into public.caregiver_checkins (check_in_id, person_id, kind, plan_id, note, reporter_user_id, reporter_role, source, at, idempotency_key)
  values ((p->>'checkInId')::uuid, (p->>'personId')::uuid, p->>'kind', (p->>'planId')::uuid, p->>'note',
          (p->>'reporterUserId')::uuid, p->>'reporterRole', p->>'source', (p->>'at')::timestamptz, p->>'idempotencyKey')
  on conflict (person_id, reporter_user_id, idempotency_key) do nothing
  returning * into row;
  if found then return pg_catalog.jsonb_build_object('row', pg_catalog.to_jsonb(row), 'duplicate', false, 'conflict', false); end if;
  select * into row from public.caregiver_checkins
   where person_id = (p->>'personId')::uuid and reporter_user_id = (p->>'reporterUserId')::uuid and idempotency_key = p->>'idempotencyKey';
  return pg_catalog.jsonb_build_object('row', pg_catalog.to_jsonb(row), 'duplicate', true, 'conflict',
    not (row.kind = p->>'kind' and row.plan_id is not distinct from (p->>'planId')::uuid
         and coalesce(row.note, '') = coalesce(p->>'note', '') and row.source = p->>'source'));
end $$;

revoke execute on function public.caregiver_create_person(uuid, jsonb, text, uuid, jsonb, timestamptz, uuid, text[]) from public, anon, authenticated;
revoke execute on function public.caregiver_other_managers(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.caregiver_upsert_grant(uuid, uuid, text[], uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.caregiver_revoke_grant(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.caregiver_record_checkin(jsonb) from public, anon, authenticated;
grant execute on function public.caregiver_create_person(uuid, jsonb, text, uuid, jsonb, timestamptz, uuid, text[]) to service_role;
grant execute on function public.caregiver_other_managers(uuid, uuid) to service_role;
grant execute on function public.caregiver_upsert_grant(uuid, uuid, text[], uuid, timestamptz) to service_role;
grant execute on function public.caregiver_revoke_grant(uuid, uuid, timestamptz) to service_role;
grant execute on function public.caregiver_record_checkin(jsonb) to service_role;
