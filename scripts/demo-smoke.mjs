// Demo smoke test: runs the rehearsed DayBridge demo over HTTP against a running server.
// Usage: BASE_URL=http://localhost:3000 npm run demo:check   (DEMO_ACTIVITY=a,b,c adds fallback activity ids)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const t0 = Date.now();
let step = 0;
const STOP = Symbol("stop");

async function http(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  }).catch((err) => {
    throw new Error(`${method} ${path}: ${err.cause?.code ?? err.message} (is the server running at ${BASE}?)`);
  });
  if (res.status === 403 && path.endsWith("/events")) {
    throw new Error("403 on /events: server is in production mode; restart it with DAYBRIDGE_DEMO_EVENTS=1 to enable demo provider events");
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (res.status !== 200) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

async function run(name, fn) {
  const s = Date.now();
  try {
      const note = await fn();
      console.log(`PASS ${String(step).padStart(2)} ${name} (${Date.now() - s}ms)${note ? ` - ${note}` : ""}`);
    } catch (err) {
      console.log(`FAIL ${String(step).padStart(2)} ${name} (${Date.now() - s}ms) - ${err instanceof Error ? err.message : err}`);
      console.log(`total ${Date.now() - t0}ms`);
      // ponytail: exitCode + throw instead of process.exit(), which trips a libuv assertion on Windows with open fetch sockets
      process.exitCode = 1;
      throw STOP;
    }
    step++;
  }

  const MARGARET = {
    name: "Margaret", interests: ["music", "gardening", "cards"], mobility: "walker", transport: ["bus", "family"],
    maxTravelMin: 30, times: ["morning", "afternoon"], budgetPerWeek: 10, hearingImpaired: true, prefersSmallGroups: true,
  };
  const MAYA = {
    name: "Maya", interests: ["faith"], mobility: "walker", transport: ["family", "paratransit"],
    maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 10, hearingImpaired: false, prefersSmallGroups: true,
  };
  const CONTACTS = [
    { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
    { id: "dan", name: "Dan", relation: "son", canDrive: true },
  ];

  let plan;
  const seq = new Map(); // per-requestId sequence counters
  let lastEvent;
  const cmd = async (body) => {
    const r = await http("POST", `/api/coordination/plans/${plan.id}/commands`, body);
    plan = r.plan;
    return r;
  };
  const current = () => plan.actions.filter((a) => a.status !== "superseded");
  const action = (kind) => current().find((a) => a.scope.kind === kind);
  const dep = (kind) => plan.dependencies.find((d) => d.actionId === action(kind)?.id);
  const expectState = (s) => assert.equal(plan.state, s, `expected state ${s}, got ${plan.state}`);
  async function event(kind, type) {
    const requestId = action(kind)?.providerRequestId;
    assert.ok(requestId, `no providerRequestId on current ${kind} action`);
    const sequence = (seq.get(requestId) ?? 0) + 1;
    seq.set(requestId, sequence);
    lastEvent = { eventId: randomUUID(), requestId, sequence, type, actor: "demo" };
    const r = await http("POST", `/api/coordination/plans/${plan.id}/events`, lastEvent);
    plan = r.plan;
    assert.equal(r.outcome, "applied", `${type}: outcome ${r.outcome} ${r.reason ?? ""}`);
    return r;
  }
  async function approveProposed() {
    const todo = current().filter((a) => a.status === "proposed");
    assert.ok(todo.length > 0, "no proposed actions to approve");
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    for (const a of todo) {
      const r = await cmd({ type: "approve", actionId: a.id, scope: a.scope, expiresAt });
      assert.equal(r.outcome, "applied", `approve ${a.scope.kind}->${a.scope.recipientId}: ${r.outcome} ${r.reason ?? ""}`);
    }
    return todo.map((a) => `${a.scope.kind}->${a.scope.recipientId}`).join(", ");
  }

  console.log(`DayBridge demo smoke against ${BASE}`);

  try {

  await run("home + analyze", async () => {
    const home = await fetch(BASE + "/", { signal: AbortSignal.timeout(60_000) }).catch((err) => {
      throw new Error(`GET /: ${err.cause?.code ?? err.message} (is the server running at ${BASE}?)`);
    });
    assert.equal(home.status, 200, `GET / -> ${home.status}`);
    const r = await http("POST", "/api/analyze", { profile: MARGARET });
    assert.ok(Array.isArray(r.plan), "analyze: plan[] missing");
    assert.ok(r.dataSource, "analyze: dataSource missing");
    return `${r.plan.length} plan items, dataSource=${r.dataSource}`;
  });

  await run("create Maya plan", async () => {
    const fallbacks = (process.env.DEMO_ACTIVITY || "").split(",").map((s) => s.trim()).filter(Boolean);
    const tried = [];
    for (const activityId of ["fellowship", ...fallbacks]) {
      let r;
      try {
        r = await http("POST", "/api/coordination/plans", { profile: MAYA, activityId, contacts: CONTACTS });
      } catch (err) {
        console.log(`WARN activity "${activityId}": ${err.message}`);
        tried.push(activityId);
        continue;
      }
      plan = r.plan;
      if (plan.state !== "BLOCKED" && action("ride")) return `${plan.activityName} (${activityId}), ${plan.state}, actions: ${current().map((a) => `${a.scope.kind}->${a.scope.recipientId}`).join(", ")}`;
      console.log(`WARN activity "${activityId}" is ${plan.state}${action("ride") ? "" : " with no ride action"} (catalog changed?)`);
      tried.push(activityId);
    }
    throw new Error(`no usable demo activity (tried ${tried.join(", ")}). Set DEMO_ACTIVITY=<id>[,<id>] to a step-free, large-group activity with family+paratransit travel <= 30 min`);
  });

  await run("accept -> consent gate", async () => {
    const a = await cmd({ type: "accept_proposal" });
    assert.equal(a.outcome, "applied");
    expectState("AWAITING_APPROVAL");
    const e = await cmd({ type: "execute" });
    assert.equal(e.outcome, "rejected", `execute before approval should be rejected, got ${e.outcome}`);
    return `execute refused: ${e.reason}`;
  });

  await run("approve actions", async () => `approved ${await approveProposed()}`);

  await run("execute -> PENDING_CONFIRMATION", async () => {
    const r = await cmd({ type: "execute" });
    assert.equal(r.outcome, "applied", `${r.outcome} ${r.reason ?? ""}`);
    expectState("PENDING_CONFIRMATION");
    const deps = plan.dependencies.filter((d) => current().some((a) => a.id === d.actionId));
    assert.ok(deps.length > 0 && deps.every((d) => d.status === "requested"), `deps: ${deps.map((d) => d.status)}`);
    return `${deps.length} deps requested`;
  });

  await run("invite.accepted + ride.confirmed -> READY", async () => {
    if (action("invite")) await event("invite", "invite.accepted");
    await event("ride", "ride.confirmed");
    expectState("READY");
  });

  await run("replay last event -> duplicate", async () => {
    const r = await http("POST", `/api/coordination/plans/${plan.id}/events`, lastEvent);
    plan = r.plan;
    assert.equal(r.outcome, "duplicate");
    expectState("READY");
  });

  await run("ride.cancelled -> NEEDS_REPLAN", async () => {
    const oldRide = action("ride").id;
    const r = await event("ride", "ride.cancelled");
    expectState("NEEDS_REPLAN");
    assert.ok(r.events.some((e) => e.type === "plan.ready_revoked"), "plan.ready_revoked event missing");
    const ride = action("ride");
    assert.ok(ride && ride.id !== oldRide && ride.status === "proposed", "no new ride action proposed");
    if (action("invite")) assert.equal(dep("invite")?.status, "confirmed", "invite should stay confirmed");
    return `new ride -> ${ride.scope.recipientId}`;
  });

  await run("recover -> READY", async () => {
    assert.equal((await cmd({ type: "accept_proposal" })).outcome, "applied");
    expectState("AWAITING_APPROVAL");
    assert.equal((await cmd({ type: "execute" })).outcome, "rejected", "execute before re-approval should be rejected");
    await approveProposed();
    const r = await cmd({ type: "execute" });
    assert.equal(r.outcome, "applied", `${r.outcome} ${r.reason ?? ""}`);
    await event("ride", "ride.confirmed");
    expectState("READY");
  });

  await run("complete + feedback + confirm preference", async () => {
    assert.equal((await cmd({ type: "complete", attended: true })).outcome, "applied");
    expectState("COMPLETED");
    const before = plan.profile.maxTravelMin;
    assert.equal((await cmd({ type: "feedback", signals: ["too_far"] })).outcome, "applied");
    const patch = plan.preferencePatches.find((p) => p.status === "proposed");
    assert.ok(patch, "no proposed preference patch");
    assert.equal(plan.profile.maxTravelMin, before, "profile changed before confirmation");
    assert.equal((await cmd({ type: "confirm_preference", patchId: patch.id })).outcome, "applied");
    assert.equal(plan.profileVersion, 2, `profileVersion ${plan.profileVersion}`);
    return `${patch.field} ${patch.from} -> ${patch.to}, profile v${plan.profileVersion}`;
  });

  let timeline = [];
  await run("GET plan + event log", async () => {
    const r = await http("GET", `/api/coordination/plans/${plan.id}`);
    assert.ok(r.events.length > 0, "empty event log");
    assert.equal(r.plan.state, "COMPLETED");
    timeline = r.events.map((e) => (e.outcome === "applied" ? e.type : `${e.type}[${e.outcome}]`));
    return `${r.events.length} events`;
  });

  console.log(`ALL PASS in ${Date.now() - t0}ms`);
  console.log(`timeline: ${timeline.join(" > ")}`);
} catch (err) {
  if (err !== STOP) throw err;
}
