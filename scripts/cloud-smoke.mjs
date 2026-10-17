// Cross-process cloud smoke test. Needs two `next start` servers on the same Supabase and these env vars:
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Usage: node scripts/cloud-smoke.mjs http://127.0.0.1:3101 http://127.0.0.1:3102
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const [A, B] = process.argv.slice(2);
const STATE = process.env.SMOKE_STATE; // optional: file to hand plan id + token to a post-restart `reload` run
const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
async function guest() {
  const { data, error } = await sb().auth.signInAnonymously();
  if (error) throw error;
  return data.session.access_token;
}
async function call(base, path, token, body, headers = {}) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, persistence: res.headers.get("x-daybridge-persistence"), body: await res.json().catch(() => null) };
}
const ok = (name) => console.log(`ok  ${name}`);

if (B === "reload") {
  // node scripts/cloud-smoke.mjs <base> reload  (after restarting the servers)
  const { id, token, events } = JSON.parse(readFileSync(STATE, "utf8"));
  const r = await call(A, `/api/coordination/plans/${id}`, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.events.length, events);
  console.log(`ok  plan ${id} survives server restart (${r.body.plan.state}, ${events} events)`);
  process.exit(0);
}

const alice = await guest();
const bob = await guest();
const profile = { name: "Margaret", interests: ["music", "gardening", "cards"], mobility: "walker", transport: ["bus", "family"], maxTravelMin: 30, times: ["morning", "afternoon"], budgetPerWeek: 10, hearingImpaired: true, prefersSmallGroups: true }; // = DEMO_PROFILES.margaret

assert.equal((await call(A, "/api/coordination/plans", null, { profile, activityId: "walk" })).status, 401);
ok("no token -> 401");
assert.equal((await call(A, "/api/coordination/plans", "not.a.jwt", { profile, activityId: "walk" })).status, 401);
ok("forged token -> 401");

const made = await call(A, "/api/coordination/plans", alice, { profile, activityId: "walk", contacts: [{ id: "c1", name: "Pat", canDrive: true }] });
assert.equal(made.status, 200, JSON.stringify(made.body));
assert.equal(made.persistence, "supabase");
const id = made.body.plan.id;
ok(`alice created plan ${id} on server A (${made.body.plan.state})`);

const got = await call(B, `/api/coordination/plans/${id}`, alice);
assert.equal(got.status, 200);
assert.equal(got.body.plan.id, id);
ok("server B (separate process) loads alice's plan");

assert.equal((await call(B, `/api/coordination/plans/${id}`, bob)).status, 404);
assert.equal((await call(A, `/api/coordination/plans/${id}/commands`, bob, { type: "cancel" })).status, 404);
ok("bob cannot read or cancel alice's plan (404)");

assert.equal((await call(B, `/api/coordination/plans/${id}/commands`, alice, { type: "execute" })).body.outcome, "rejected");
ok("execute before approval is rejected");

assert.equal((await call(B, `/api/coordination/plans/${id}/commands`, alice, { type: "accept_proposal" })).body.plan.state, "AWAITING_APPROVAL");
let plan = (await call(A, `/api/coordination/plans/${id}`, alice)).body.plan;
const actions = plan.actions.filter((a) => a.status === "proposed");
assert.ok(actions.length > 0);
const expiresAt = new Date(Date.now() + 3600_000).toISOString();
const bad = await call(A, `/api/coordination/plans/${id}/commands`, alice, { type: "approve", actionId: actions[0].id, scope: { ...actions[0].scope, sharedFields: ["everything"] }, expiresAt });
assert.equal(bad.body.outcome, "rejected");
ok("approval with mismatched scope rejected");

// Approvals race across both processes; CAS must keep every one and a contiguous log.
const results = await Promise.all(actions.map((a, i) => call(i % 2 ? B : A, `/api/coordination/plans/${id}/commands`, alice, { type: "approve", actionId: a.id, scope: a.scope, expiresAt })));
for (const r of results) assert.ok(r.status === 200 || r.status === 409, `unexpected ${r.status}`);
for (const [i, r] of results.entries()) if (r.status === 409) await call(A, `/api/coordination/plans/${id}/commands`, alice, { type: "approve", actionId: actions[i].id, scope: actions[i].scope, expiresAt });
const after = (await call(B, `/api/coordination/plans/${id}`, alice)).body;
assert.ok(after.plan.actions.filter((a) => a.status !== "superseded").every((a) => a.status === "approved"));
assert.deepEqual(after.events.map((e) => e.seq), after.events.map((_, i) => i + 1));
ok(`concurrent approvals across processes: all applied, log seq 1..${after.events.length} contiguous (409s: ${results.filter((r) => r.status === 409).length})`);

const exec = await call(A, `/api/coordination/plans/${id}/commands`, alice, { type: "execute" });
assert.equal(exec.body.plan.state, "PENDING_CONFIRMATION");
ok("execute -> PENDING_CONFIRMATION (not READY without confirmations)");

const ev = await call(B, `/api/coordination/plans/${id}/events`, alice, { eventId: "e1", requestId: exec.body.plan.actions[0].providerRequestId, sequence: 1, type: "ride.confirmed", actor: "demo" });
assert.equal(ev.status, 403);
ok("production demo-event injection is disabled (403)");

plan = (await call(B, `/api/coordination/plans/${id}`, alice)).body.plan;
assert.notEqual(plan.state, "READY");
ok(`state ${plan.state} after execute; READY still requires confirmed dependencies`);
// Signed provider callbacks (simulated providers only) are the one production path to confirmation.
// Enabled when the servers run with PROVIDER_WEBHOOK_SECRET_MOCK_RIDE / _MOCK_INVITE; pass the same values here.
const SECRETS = { "mock-ride": process.env.PROVIDER_WEBHOOK_SECRET_MOCK_RIDE, "mock-invite": process.env.PROVIDER_WEBHOOK_SECRET_MOCK_INVITE };
if (SECRETS["mock-ride"] && SECRETS["mock-invite"]) {
  const callback = async (base, provider, body, secret = SECRETS[provider]) => {
    const raw = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
    const res = await fetch(`${base}/api/providers/${provider}/callback`, { method: "POST", headers: { "content-type": "application/json", "x-daybridge-signature": sig }, body: raw });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const live = plan.actions.filter((a) => a.status === "dispatched");
  const evFor = (a, n) => ({ planId: id, eventId: `smoke-${a.id}-${n}`, requestId: a.providerRequestId, sequence: 1, type: a.scope.kind === "ride" ? "ride.confirmed" : "invite.accepted" });
  const forged = await callback(A, "mock-ride", evFor(live[0], 0), "x".repeat(40));
  assert.equal(forged.status, 401);
  ok("callback with a wrong signature -> 401");
  for (const [i, a] of live.entries()) {
    const r = await callback(i % 2 ? B : A, a.scope.kind === "ride" ? "mock-ride" : "mock-invite", evFor(a, 1));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome, "applied");
  }
  const replay = await callback(B, live[0].scope.kind === "ride" ? "mock-ride" : "mock-invite", evFor(live[0], 1));
  assert.equal(replay.body.outcome, "duplicate");
  ok("signed callback replayed on the other process -> duplicate");
  plan = (await call(A, `/api/coordination/plans/${id}`, alice)).body.plan;
  assert.equal(plan.state, "READY");
  ok("all dependencies confirmed by signed callbacks across processes -> READY");
}

if (STATE) writeFileSync(STATE, JSON.stringify({ id, token: alice, events: (await call(A, `/api/coordination/plans/${id}`, alice)).body.events.length }));
console.log("cloud smoke: all checks passed");
