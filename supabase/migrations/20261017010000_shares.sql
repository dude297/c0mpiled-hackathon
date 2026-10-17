-- DayBridge share links: opt-in, redacted, read-only plan snapshots (docs/daybridge/SHARE_CONTRACT.md).
-- Server-only: read and written through the secret key (src/lib/share/share.ts); the public /plan/[id] page
-- reads through the server. No link to coordination_* tables: a snapshot confers no coordination authority.

create table public.share_snapshots (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),     -- 128-bit random, base64url
  plan jsonb not null,                                           -- the redacted SharedPlan only, Zod-validated on read
  token_hash bytea not null check (octet_length(token_hash) = 32), -- SHA-256 of the 256-bit revoke token
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index share_snapshots_expires_at_idx on public.share_snapshots (expires_at);

alter table public.share_snapshots enable row level security;  -- no policies: server-only
revoke all on public.share_snapshots from public, anon, authenticated;

-- Atomic create with the memory store's ceiling semantics: prune expired, insert, then evict the oldest
-- unexpired rows beyond p_cap. A transaction-scoped advisory lock serializes concurrent creates.
create function public.share_snapshot_create(p_id text, p_plan jsonb, p_token_hash bytea, p_expires_at timestamptz, p_now timestamptz, p_cap int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.share_snapshots'));
  delete from public.share_snapshots where expires_at <= p_now;
  insert into public.share_snapshots (id, plan, token_hash, expires_at) values (p_id, p_plan, p_token_hash, p_expires_at);
  delete from public.share_snapshots where id in (
    select id from public.share_snapshots order by created_at desc, id desc offset greatest(p_cap, 1));
end $$;
revoke execute on function public.share_snapshot_create(text, jsonb, bytea, timestamptz, timestamptz, int) from public, anon, authenticated;
grant execute on function public.share_snapshot_create(text, jsonb, bytea, timestamptz, timestamptz, int) to service_role;
