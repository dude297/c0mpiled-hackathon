// Cross-process cloud smoke test. Needs two `next start` servers on the same Supabase and these env vars:
// NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Usage: node scripts/cloud-smoke.mjs http://127.0.0.1:3101 http://127.0.0.1:3102
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

import { readFileSync, writeFileSync } from "node:fs";

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
ok(`final state ${plan.state}; READY still requires confirmed dependencies`);
if (STATE) writeFileSync(STATE, JSON.stringify({ id, token: alice, events: (await call(A, `/api/coordination/plans/${id}`, alice)).body.events.length }));
console.log("cloud smoke: all checks passed");
