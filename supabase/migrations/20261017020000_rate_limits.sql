-- Per-key fixed-window rate limits (src/lib/supabase/ratelimit.ts). Server-only: called with the secret key.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);
create index rate_limits_window_end_idx on public.rate_limits (window_end);

alter table public.rate_limits enable row level security;  -- no policies: server-only
revoke all on public.rate_limits from public, anon, authenticated;

-- Atomic: one upsert per hit, returns whether this hit is within p_limit for the current window.
-- Windows are aligned to the Unix epoch (same math as retryAfterSec in ratelimit.ts).
create function public.rate_limit_hit(p_key text, p_limit int, p_window_sec int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_sec) * p_window_sec);
  v_count int;
begin
  if p_window_sec < 1 or p_key is null then raise exception 'invalid rate limit args'; end if;
  insert into public.rate_limits as r (key, window_start, window_end)
    values (p_key, v_start, v_start + pg_catalog.make_interval(secs => p_window_sec))
    on conflict (key, window_start) do update set count = r.count + 1
    returning r.count into v_count;
  -- Opportunistic cleanup of finished windows (~1% of hits).
  if pg_catalog.random() < 0.01 then
    delete from public.rate_limits where window_end < pg_catalog.now();
  end if;
  return v_count <= p_limit;
end $$;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
