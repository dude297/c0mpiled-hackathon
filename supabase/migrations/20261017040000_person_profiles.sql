-- Person profiles: versioned, confirmed updates (docs/daybridge/PERSON_PROFILES.md). Stacked on 20261017030000_caregiver.sql.
-- caregiver_people.profile + profile_version = the current profile; person_profile_versions is append-only history.
-- A proposal never changes the profile; only confirm / append (revert) do, atomically, under the person row lock.

alter table public.caregiver_people add column profile_version int not null default 1;
alter table public.caregiver_plan_links add column profile_version int;

create table public.person_profile_versions (
  person_id uuid not null references public.caregiver_people(person_id) on delete cascade,
  version int not null check (version >= 1),
  profile jsonb not null,
  source text not null check (source in ('create', 'caregiver', 'self', 'intake', 'feedback', 'revert')),
  proposal_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (person_id, version)   -- unique(person_id, version): the backstop against two writers of N+1
);

create table public.profile_proposals (
  proposal_id uuid primary key,
  person_id uuid not null references public.caregiver_people(person_id) on delete cascade,
  base_version int not null,
  changes jsonb not null,
  evidence text not null check (char_length(evidence) between 1 and 280),
  source text not null check (source in ('caregiver', 'self', 'intake', 'feedback')),
  proposed_by uuid not null,
  plan_id uuid,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected', 'stale')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index profile_proposals_person_status_idx on public.profile_proposals (person_id, status);

-- Self may read their own profile history and proposals (grantees via caregiver_has_grant).
create function public.caregiver_is_self(p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.caregiver_people p where p.person_id = p_person and p.self_user_id = (select auth.uid()))
$$;
revoke execute on function public.caregiver_is_self(uuid) from public, anon;
grant execute on function public.caregiver_is_self(uuid) to authenticated, service_role;

alter table public.person_profile_versions enable row level security;
alter table public.profile_proposals       enable row level security;
create policy "grantee or self reads versions" on public.person_profile_versions for select to authenticated
  using (public.caregiver_has_grant(person_id) or public.caregiver_is_self(person_id));
create policy "grantee or self reads proposals" on public.profile_proposals for select to authenticated
  using (public.caregiver_has_grant(person_id) or public.caregiver_is_self(person_id));
revoke all on public.person_profile_versions, public.profile_proposals from public, anon, authenticated;
grant select on public.person_profile_versions, public.profile_proposals to authenticated;

-- createPerson now also records version 1 (same signature, same transaction).
create or replace function public.caregiver_create_person(p_person_id uuid, p_profile jsonb, p_timezone text, p_self_user_id uuid,
  p_check_in_schedule jsonb, p_created_at timestamptz, p_created_by uuid, p_scopes text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.caregiver_people (person_id, profile, timezone, self_user_id, check_in_schedule, created_at, created_by, profile_version)
  values (p_person_id, p_profile, p_timezone, p_self_user_id, p_check_in_schedule, p_created_at, p_created_by, 1);
  insert into public.person_profile_versions (person_id, version, profile, source, created_by, created_at)
  values (p_person_id, 1, p_profile, 'create', p_created_by, p_created_at);
  insert into public.caregiver_grants (person_id, user_id, scopes, granted_by, granted_at)
  values (p_person_id, p_created_by, p_scopes, p_created_by, p_created_at);
end $$;

-- Internal: caller holds the person row lock. Bumps the version, appends history, marks open proposals stale.
create function public.caregiver_append_profile(p_person uuid, p_profile jsonb, p_source text, p_by uuid, p_at timestamptz, p_proposal uuid)
returns public.person_profile_versions language plpgsql security definer set search_path = '' as $$
declare v public.person_profile_versions;
begin
  update public.caregiver_people set profile = p_profile, profile_version = profile_version + 1 where person_id = p_person;
  insert into public.person_profile_versions (person_id, version, profile, source, proposal_id, created_by, created_at)
  select p_person, profile_version, p_profile, p_source, p_proposal, p_by, p_at from public.caregiver_people where person_id = p_person
  returning * into v;
  update public.profile_proposals set status = 'stale', decided_at = p_at where person_id = p_person and status = 'proposed';
  return v;
end $$;

-- 'ok' | 'not_found' | 'stale' (base is not the current version).
create function public.caregiver_create_proposal(p jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare cur int;
begin
  select profile_version into cur from public.caregiver_people where person_id = (p->>'personId')::uuid for update;
  if not found then return 'not_found'; end if;
  if cur <> (p->>'baseVersion')::int then return 'stale'; end if;
  insert into public.profile_proposals (proposal_id, person_id, base_version, changes, evidence, source, proposed_by, plan_id, status, created_at)
  values ((p->>'proposalId')::uuid, (p->>'personId')::uuid, (p->>'baseVersion')::int, p->'changes', p->>'evidence', p->>'source',
          (p->>'proposedBy')::uuid, (p->>'planId')::uuid, 'proposed', (p->>'createdAt')::timestamptz);
  return 'ok';
end $$;

-- {result: ok|not_found|stale|not_pending|version_conflict, proposal?, version?}. Order as in the memory store.
create function public.caregiver_decide_proposal(p_person uuid, p_proposal uuid, p_decision text, p_expected int, p_by uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur public.caregiver_people; pr public.profile_proposals; v public.person_profile_versions;
begin
  select * into cur from public.caregiver_people where person_id = p_person for update;   -- person first, then proposal
  select * into pr from public.profile_proposals where proposal_id = p_proposal and person_id = p_person for update;
  if cur.person_id is null or pr.proposal_id is null then return '{"result":"not_found"}'; end if;
  if pr.status = 'stale' then return '{"result":"stale"}'; end if;
  if pr.status <> 'proposed' then return '{"result":"not_pending"}'; end if;
  if p_decision = 'rejected' then
    update public.profile_proposals set status = 'rejected', decided_at = p_at, decided_by = p_by where proposal_id = p_proposal returning * into pr;
    return pg_catalog.jsonb_build_object('result', 'ok', 'proposal', pg_catalog.to_jsonb(pr));
  end if;
  if pr.base_version <> cur.profile_version then
    update public.profile_proposals set status = 'stale', decided_at = p_at, decided_by = p_by where proposal_id = p_proposal;
    return '{"result":"stale"}';
  end if;
  if p_expected is distinct from cur.profile_version then return '{"result":"version_conflict"}'; end if;
  v := public.caregiver_append_profile(p_person, cur.profile || pr.changes, pr.source, p_by, p_at, p_proposal);
  update public.profile_proposals set status = 'confirmed', decided_at = p_at, decided_by = p_by where proposal_id = p_proposal returning * into pr;
  return pg_catalog.jsonb_build_object('result', 'ok', 'proposal', pg_catalog.to_jsonb(pr), 'version', pg_catalog.to_jsonb(v));
end $$;

-- Compare-and-append (revert etc.). {result: ok|not_found|stale, version?}.
create function public.caregiver_append_version(p_person uuid, p_expected int, p_profile jsonb, p_source text, p_by uuid, p_at timestamptz, p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur int;
begin
  select profile_version into cur from public.caregiver_people where person_id = p_person for update;
  if not found then return '{"result":"not_found"}'; end if;
  if cur <> p_expected then return '{"result":"stale"}'; end if;
  return pg_catalog.jsonb_build_object('result', 'ok', 'version',
    pg_catalog.to_jsonb(public.caregiver_append_profile(p_person, p_profile, p_source, p_by, p_at, p_proposal)));
end $$;

revoke execute on function public.caregiver_append_profile(uuid, jsonb, text, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.caregiver_create_proposal(jsonb) from public, anon, authenticated;
revoke execute on function public.caregiver_decide_proposal(uuid, uuid, text, int, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.caregiver_append_version(uuid, int, jsonb, text, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.caregiver_append_profile(uuid, jsonb, text, uuid, timestamptz, uuid) to service_role;
grant execute on function public.caregiver_create_proposal(jsonb) to service_role;
grant execute on function public.caregiver_decide_proposal(uuid, uuid, text, int, uuid, timestamptz) to service_role;
grant execute on function public.caregiver_append_version(uuid, int, jsonb, text, uuid, timestamptz, uuid) to service_role;
