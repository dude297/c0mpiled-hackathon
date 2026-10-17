import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { approvedPlan, poisonedResult } from "./coordination-fixture";
import { ShareInput } from "./share";

// Integration tests against a real Supabase (local stack, migration 20261017010000_shares.sql applied).
// Skipped unless SUPABASE_URL + SUPABASE_SECRET_KEY are set; RLS checks also need NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const live = !!(URL_ && process.env.SUPABASE_SECRET_KEY);

// "New process": drop the module registry and globalThis singletons.
async function fresh() {
  vi.resetModules();
  for (const k of Object.keys(globalThis)) if (/daybridge/i.test(k)) delete (globalThis as Record<string, unknown>)[k];
  return { ...(await import("./share")), admin: (await import("@/lib/supabase/server")).adminClient() };
}

describe.skipIf(!live)("share store (live Supabase)", () => {
  const ids: string[] = [];
  let input: ShareInput;
  let secrets: string[];
  const created = async (s: Awaited<ReturnType<typeof fresh>>, i = input, now?: Date, cap?: number) => {
    const out = await s.createShare(i, now, cap);
    ids.push(out.id);
    return out;
  };

  afterAll(async () => {
    if (ids.length) await (await fresh()).admin.from("share_snapshots").delete().in("id", ids);
  });

  it("uses the durable store", async () => {
    const fx = await approvedPlan();
    secrets = fx.secrets;
    input = ShareInput.parse({ result: poisonedResult(fx.plan, fx.secrets), consent: true });
    expect((await fresh()).shareStoreKind()).toBe("supabase");
  });

  it("create → get → revoke (wrong token 404-equivalent) → get null; survives a restart", async () => {
    const s = await fresh();
    const { id, revokeToken } = await created(s);
    const plan = await s.getShare(id);
    expect(plan).not.toBeNull();

    const s2 = await fresh(); // restart
    expect(await s2.getShare(id)).toEqual(plan);
    expect(await s2.revokeShare(id, "wrong")).toBe(false);
    expect(await s2.revokeShare(id, "")).toBe(false);
    expect(await s2.revokeShare("A".repeat(22), revokeToken)).toBe(false);
    expect(await s2.getShare(id)).not.toBeNull();
    expect(await s2.revokeShare(id, revokeToken)).toBe(true);
    expect(await s2.getShare(id)).toBeNull();
    expect(await s2.revokeShare(id, revokeToken)).toBe(false);
  });

  it("expired snapshots are missing", async () => {
    const s = await fresh();
    const t0 = new Date(Date.now() - 2 * 86_400_000);
    const { id } = await created(s, { ...input, expiresInDays: 1 }, t0);
    expect(await s.getShare(id, new Date(t0.getTime() + 86_399_000))).not.toBeNull();
    expect(await s.getShare(id)).toBeNull();
  });

  it("stored row holds only the redacted snapshot: no coordination ids, approvals, keys, contacts or profile", async () => {
    const s = await fresh();
    const { id, revokeToken } = await created(s);
    const { data, error } = await s.admin.from("share_snapshots").select("*").eq("id", id).single();
    expect(error).toBeNull();
    expect(Object.keys(data!).sort()).toEqual(["created_at", "expires_at", "id", "plan", "token_hash"]);
    const row = JSON.stringify(data);
    for (const x of [...secrets, revokeToken]) expect(row).not.toContain(x);
    expect(JSON.stringify(data!.plan)).not.toMatch(/coordinationPlanId|approval|idempotency|contacts|profile/i);
  });

  it("invalid stored snapshot → not found", async () => {
    const s = await fresh();
    const id = "B".repeat(21) + "x";
    ids.push(id);
    const bad = { id, plan: { displayName: "x", extra: true }, token_hash: `\\x${"00".repeat(32)}`, expires_at: new Date(Date.now() + 3600_000).toISOString() };
    expect((await s.admin.from("share_snapshots").insert(bad)).error).toBeNull();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await s.getShare(id)).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("routes: POST 201 → DELETE wrong 404 → DELETE 204 → DELETE 404", async () => {
    await fresh();
    const POST = (await import("@/app/api/plans/route")).POST;
    const DELETE = (await import("@/app/api/plans/[id]/route")).DELETE;
    const res = await POST(new Request("http://t/api/plans", { method: "POST", body: JSON.stringify({ result: input.result, consent: true }) }));
    expect(res.status).toBe(201);
    const { id, url, revokeToken } = await res.json();
    ids.push(id);
    expect(url).toBe(`/plan/${id}`);
    const del = (tok?: string) =>
      DELETE(new Request(`http://t/api/plans/${id}`, { method: "DELETE", headers: tok ? { authorization: `Bearer ${tok}` } : {} }), { params: Promise.resolve({ id }) });
    expect((await del()).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
    expect((await del(revokeToken)).status).toBe(204);
    expect((await del(revokeToken)).status).toBe(404);
  });

  it("caps unexpired rows, pruning expired first, then evicting oldest (cap injected = 3)", async () => {
    const s = await fresh();
    const count = async () => (await s.admin.from("share_snapshots").select("id", { count: "exact", head: true })).count;
    const old = new Date(Date.now() - 40 * 86_400_000);
    for (let i = 0; i < 3; i++) await created(s, input, old); // already expired
    const made = [];
    for (let i = 0; i < 5; i++) made.push((await created(s, input, undefined, 3)).id);
    expect(await count()).toBe(3);
    for (const id of made.slice(0, 2)) expect(await s.getShare(id)).toBeNull(); // oldest evicted
    for (const id of made.slice(2)) expect(await s.getShare(id)).not.toBeNull();
    // Concurrent creates still respect the cap (advisory lock).
    await Promise.all(Array.from({ length: 8 }, () => created(s, input, undefined, 3)));
    expect(await count()).toBe(3);
  }, 30_000);

  describe.skipIf(!PUB)("unreachable with the publishable key", () => {
    it("anon and signed-in users can't read, write or delete share_snapshots", async () => {
      const s = await fresh();
      const { id } = await created(s);
      const anon = createClient(URL_!, PUB!, { auth: { persistSession: false, autoRefreshToken: false } });
      const user = createClient(URL_!, PUB!, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: signed, error } = await user.auth.signInAnonymously();
      expect(error).toBeNull();
      for (const c of [anon, user]) {
        const read = await c.from("share_snapshots").select("*").eq("id", id);
        expect(read.error).not.toBeNull();
        expect(read.data).toBeNull();
        expect((await c.from("share_snapshots").insert({ id: "C".repeat(22), plan: {}, token_hash: `\\x${"00".repeat(32)}`, expires_at: new Date().toISOString() })).error).not.toBeNull();
        expect((await c.from("share_snapshots").update({ plan: {} }).eq("id", id)).error).not.toBeNull();
        expect((await c.from("share_snapshots").delete().eq("id", id)).error).not.toBeNull();
        const rpc = { p_id: "D".repeat(22), p_plan: {}, p_token_hash: `\\x${"00".repeat(32)}`, p_expires_at: new Date().toISOString(), p_now: new Date().toISOString(), p_cap: 0 };
        expect((await c.rpc("share_snapshot_create", rpc)).error).not.toBeNull();
      }
      expect(await s.getShare(id)).not.toBeNull(); // untouched
      await s.admin.auth.admin.deleteUser(signed!.user!.id);
    }, 30_000);
  });
});
