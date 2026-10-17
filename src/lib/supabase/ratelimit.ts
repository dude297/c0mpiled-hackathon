import { adminClient, supabaseConfigured } from "./server";

// Fixed-window rate limiter. Server-only. true = allowed.
// Supabase configured -> atomic counter in Postgres (RPC rate_limit_hit), shared across serverless instances.
// Otherwise -> per-process Map (local dev / tests only).
const mem = new Map<string, { start: number; count: number }>();

export const windowStart = (windowSec: number, now = Date.now()) => Math.floor(now / 1000 / windowSec) * windowSec * 1000;
/** Seconds until the current fixed window ends (for Retry-After). Same epoch alignment as the SQL function. */
export const retryAfterSec = (windowSec: number, now = Date.now()) => Math.max(1, Math.ceil((windowStart(windowSec, now) + windowSec * 1000 - now) / 1000));

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (!supabaseConfigured()) {
    const start = windowStart(windowSec);
    const id = `${windowSec}:${key}`;
    const cur = mem.get(id);
    if (!cur || cur.start !== start) {
      if (mem.size > 10_000) for (const [k, v] of mem) if (v.start !== windowStart(Number(k.split(":")[0]))) mem.delete(k); // ponytail: O(n) sweep, rare
      mem.set(id, { start, count: 1 });
      return limit >= 1;
    }
    return ++cur.count <= limit;
  }
  try {
    const { data, error } = await adminClient().rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_sec: windowSec });
    if (error) throw error;
    return data === true;
  } catch (err) {
    // Fail CLOSED: callers gate writes. If the limiter's DB is unreachable the write would fail anyway,
    // and an attacker must not be able to bypass limits by inducing limiter errors. Details stay server-side.
    console.error("rate limit check failed:", err instanceof Error ? err.message : "unknown");
    return false;
  }
}
