import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { adminClient } from "./server";
import { rateLimit } from "./ratelimit";

// Real local Supabase (`supabase start` + env from `supabase status -o env`). Skipped otherwise.
const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = !!(URL_ && process.env.SUPABASE_SECRET_KEY && PUB);
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!live)("rate_limit_hit (real DB)", () => {
  it("N concurrent hits with limit L -> exactly L allowed", async () => {
    const key = `t:${randomUUID()}`;
    const res = await Promise.all(Array.from({ length: 40 }, () => rateLimit(key, 7, 3600)));
    expect(res.filter(Boolean)).toHaveLength(7);
  });

  it("isolates keys", async () => {
    const a = `t:${randomUUID()}`, b = `t:${randomUUID()}`;
    expect(await rateLimit(a, 1, 3600)).toBe(true);
    expect(await rateLimit(a, 1, 3600)).toBe(false);
    expect(await rateLimit(b, 1, 3600)).toBe(true);
  });

  it("rolls over to a fresh window", async () => {
    const key = `t:${randomUUID()}`;
    // DB clock decides windows (may differ from host): hit until blocked, i.e. the window is exhausted.
    let blocked = false;
    for (let i = 0; i < 10 && !blocked; i++) blocked = !(await rateLimit(key, 1, 2));
    expect(blocked).toBe(true);
    await new Promise((r) => setTimeout(r, 2100)); // > one full window later
    expect(await rateLimit(key, 1, 2)).toBe(true);
  });

  it("anon/authenticated cannot read the table or execute the RPC", async () => {
    const key = `t:${randomUUID()}`;
    await rateLimit(key, 5, 3600);
    expect((await adminClient().from("rate_limits").select("count").eq("key", key)).data).toEqual([{ count: 1 }]);
    const anon = createClient(URL_!, PUB!, { auth: { persistSession: false } });
    const authed = createClient(URL_!, PUB!, { auth: { persistSession: false } });
    const { error: signErr } = await authed.auth.signInAnonymously();
    expect(signErr).toBeNull();
    for (const c of [anon, authed]) {
      const read = await c.from("rate_limits").select("*");
      expect(read.error).not.toBeNull(); // permission denied (no grants)
      const rpc = await c.rpc("rate_limit_hit", { p_key: key, p_limit: 5, p_window_sec: 3600 });
      expect(rpc.error).not.toBeNull();
      const ins = await c.from("rate_limits").insert({ key, window_start: new Date().toISOString(), window_end: new Date().toISOString() });
      expect(ins.error).not.toBeNull();
    }
    expect((await adminClient().from("rate_limits").select("count").eq("key", key)).data).toEqual([{ count: 1 }]);
  });
});
