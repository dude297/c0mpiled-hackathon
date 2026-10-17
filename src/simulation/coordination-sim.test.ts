// Phase 2 simulation harness for the DayBridge coordination engine (PR #3).
//
// Ownership: simulation/QA workstream only (src/simulation/**). These tests drive the
// REAL coordinator from src/domain/coordination — no reimplementation — through its
// public surface (create / command / ingest / get), with a fixed clock and the
// injectable ProviderPort. Fully offline and deterministic.

import { describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activities";
import { createCoordinator, currentActions, readyViolations, type Coordinator } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import type { ProviderPort } from "@/domain/coordination/provider";
import { CommandResult, CoordinationPlan, type Contact, type Profile, type ProviderEvent } from "@/lib/schema";

// ─── synthetic fixtures (never the human-owned catalog) ───────────────────────

const WORKSHOP: Activity = {
  id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon",
  costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true,
  groupSize: "large", noisy: false, hearingLoop: false,
};
const LOFT: Activity = { id: "loft", name: "Upstairs Pottery Loft", tags: ["crafts"], day: "Tue", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: false, groupSize: "small", noisy: false, hearingLoop: false };
const CIRCLE: Activity = { id: "circle", name: "Library Knitting Circle", tags: ["crafts"], day: "Wed", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false };
const CATALOG = [WORKSHOP, LOFT, CIRCLE];

const MAYA: Profile = {
  name: "Maya", interests: ["crafts"], mobility: "walker",
  transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"],
  budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true,
};
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];

const T0 = Date.parse("2026-10-17T12:00:00Z");
const HOUR = 3600_000;

let eventIdCounter = 0;
const ev = (requestId: string, type: ProviderEvent["type"], sequence = 1, extra: Partial<ProviderEvent> = {}): ProviderEvent =>
  ({ eventId: `sim-ev-${++eventIdCounter}`, requestId, sequence, type, actor: "demo", ...extra });

type Sim = {
  c: Coordinator;
  provider: ReturnType<typeof createMockProvider>;
  advance: (ms: number) => void;
  at: (ms: number) => string;
};

function setup(opts: { fail?: (i: { recipientId: string }) => boolean } = {}): Sim {
  let t = T0;
  let n = 0;
  const provider = createMockProvider({ fail: opts.fail });
  const c = createCoordinator({
    provider,
    now: () => new Date(t),
    activities: CATALOG,
    newId: () => `sim-plan-${++n}`,
  });
  return { c, provider, advance: (ms) => (t += ms), at: (ms) => new Date(t + ms).toISOString() };
}

const ok = (r: CommandResult, label = "") => {
  CommandResult.parse(r); // every result must satisfy the published contract
  if (r.outcome !== "applied") throw new Error(`expected applied${label ? ` (${label})` : ""}, got ${r.outcome}: ${r.reason}`);
  return r;
};

const rideReqOf = (plan: CoordinationPlan) =>
  currentActions(plan).find((a) => a.scope.kind === "ride")!.providerRequestId!;
const inviteReqOf = (plan: CoordinationPlan) =>
  currentActions(plan).find((a) => a.scope.kind === "invite")?.providerRequestId;

// Approve every action that still needs approval (proposed/revoked); dispatched or
// carried-over confirmed actions are intentionally skipped.
async function approvePending(s: Sim, id: string) {
  for (const a of currentActions((await s.c.get(id)).plan)) {
    if (a.status !== "proposed" && a.status !== "revoked") continue;
    ok(await s.c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(HOUR) }), `approve ${a.id}`);
  }
}

async function create(s: Sim, profile = MAYA, contacts = CONTACTS, activityId = "workshop") {
  return ok(await s.c.create({ profile, activityId, contacts }), "create");
}

async function toDispatched(s: Sim, profile = MAYA, contacts = CONTACTS, activityId = "workshop") {
  const created = await create(s, profile, contacts, activityId);
  const id = created.plan.id;
  ok(await s.c.command(id, { type: "accept_proposal" }), "accept");
  await approvePending(s, id);
  const exec = ok(await s.c.command(id, { type: "execute" }), "execute");
  return { id, exec };
}

async function toReady(s: Sim, profile = MAYA, contacts = CONTACTS, activityId = "workshop") {
  const { id, exec } = await toDispatched(s, profile, contacts, activityId);
  ok(await s.c.ingest(id, ev(inviteReqOf(exec.plan)!, "invite.accepted")), "invite accepted");
  const ready = ok(await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.confirmed")), "ride confirmed");
  return { id, exec, ready };
}

// ─── adversarial event sequences ──────────────────────────────────────────────

describe("Phase 2: adversarial provider-event simulation", () => {
  it("duplicate callback (same idempotencyKey, different eventId+type) cannot flip a confirmed dep", async () => {
    const s = setup();
    const { id, exec } = await toDispatched(s);
    const rideReq = rideReqOf(exec.plan);
    const first = ok(await s.c.ingest(id, ev(rideReq, "ride.confirmed", 1, { idempotencyKey: "cb-ride-1" })), "first confirm");
    expect(first.plan.state).toBe("PENDING_CONFIRMATION"); // invite still open
    expect(first.plan.dependencies.find((d) => d.kind === "ride")!.status).toBe("confirmed");

    // A replayed callback with the same idempotency key but a forged new type must not undo the confirmation.
    const dupe = await s.c.ingest(id, { ...ev(rideReq, "ride.cancelled", 2), idempotencyKey: "cb-ride-1" });
    expect(dupe.outcome).toBe("duplicate");
    expect(dupe.plan.dependencies.find((d) => d.kind === "ride")!.status).toBe("confirmed"); // unchanged
    expect(dupe.plan.state).toBe("PENDING_CONFIRMATION");
  });

  it("replayed event with same eventId is a duplicate, state unchanged", async () => {
    const s = setup();
    const { id, exec } = await toDispatched(s);
    const e = ev(inviteReqOf(exec.plan)!, "invite.accepted", 1);
    expect(ok(await s.c.ingest(id, e), "first").plan.state).toBe("PENDING_CONFIRMATION");
    const replay = await s.c.ingest(id, e);
    expect(replay.outcome).toBe("duplicate");
    expect(replay.plan.state).toBe("PENDING_CONFIRMATION");
  });

  it("out-of-order: lower or equal sequence after higher is ignored and never downgrades state", async () => {
    const s = setup();
    const { id, exec } = await toDispatched(s);
    const rideReq = rideReqOf(exec.plan);
    ok(await s.c.ingest(id, ev(rideReq, "ride.cancelled", 3)), "cancel seq3");
    expect((await s.c.get(id)).plan.state).toBe("NEEDS_REPLAN");
    const stale = await s.c.ingest(id, ev(rideReq, "ride.confirmed", 2));
    expect(stale.outcome).toBe("ignored");
    expect(stale.plan.state).toBe("NEEDS_REPLAN");
    const equal = await s.c.ingest(id, ev(rideReq, "ride.confirmed", 3));
    expect(equal.outcome).toBe("ignored"); // sequence must strictly increase
  });

  it("late confirmation after cancellation is ignored (superseded request)", async () => {
    const s = setup();
    const { id, exec } = await toReady(s);
    const oldRideReq = rideReqOf(exec.plan);
    const cancelled = ok(await s.c.ingest(id, ev(oldRideReq, "ride.cancelled", 2)), "cancel after READY");
    expect(cancelled.plan.state).toBe("NEEDS_REPLAN");
    expect(cancelled.events.map((e) => e.type)).toContain("plan.ready_revoked");
    // a stale confirmation for the OLD request id arrives late
    const late = await s.c.ingest(id, ev(oldRideReq, "ride.confirmed", 3));
    expect(late.outcome).toBe("ignored");
    expect(late.plan.state).toBe("NEEDS_REPLAN");
    expect(readyViolations(late.plan).length).toBeGreaterThan(0); // definitely not READY
  });

  it("decline after accept revokes READY (contract: declined-after-confirmed = cancelled)", async () => {
    const s = setup();
    const { id } = await toReady(s);
    expect((await s.c.get(id)).plan.state).toBe("READY");
    const inviteAction = currentActions((await s.c.get(id)).plan).find((a) => a.scope.kind === "invite")!;
    const seq = (await s.c.get(id)).plan.dependencies.find((d) => d.actionId === inviteAction.id)!.lastSequence + 1;
    const revoked = ok(await s.c.ingest(id, ev(inviteAction.providerRequestId!, "invite.declined", seq)), "decline after accept");
    expect(revoked.plan.state).toBe("NEEDS_REPLAN");
    const dep = revoked.plan.dependencies.find((d) => d.kind === "invite")!;
    expect(["cancelled", "declined"]).toContain(dep.status);
    expect(readyViolations(revoked.plan).length).toBeGreaterThan(0);
  });

  it("events for a CANCELLED or COMPLETED plan are ignored, never applied", async () => {
    const s = setup();
    const { id, exec } = await toReady(s);
    ok(await s.c.command(id, { type: "cancel" }), "cancel");
    const afterCancel = await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.cancelled", 2));
    expect(afterCancel.outcome).toBe("ignored");
    expect((await s.c.get(id)).plan.state).toBe("CANCELLED");

    const s2 = setup();
    const r2 = await toReady(s2);
    ok(await s2.c.command(r2.id, { type: "complete", attended: true }), "complete");
    const afterComplete = await s2.c.ingest(r2.id, ev(rideReqOf(r2.exec.plan), "ride.cancelled", 2));
    expect(afterComplete.outcome).toBe("ignored");
    expect((await s2.c.get(r2.id)).plan.state).toBe("COMPLETED");
  });

  it("rejected events (forged requestId, wrong kind, pre-dispatch) never change state", async () => {
    const s = setup();
    const created = await create(s);
    const id = created.plan.id;
    const before = (await s.c.get(id)).plan.state;
    expect((await s.c.ingest(id, ev("forged-request", "ride.confirmed"))).outcome).toBe("rejected");
    expect((await s.c.get(id)).plan.state).toBe(before);

    ok(await s.c.command(id, { type: "accept_proposal" }), "accept");
    await approvePending(s, id);
    const exec = ok(await s.c.command(id, { type: "execute" }), "execute");
    expect((await s.c.ingest(id, ev(inviteReqOf(exec.plan)!, "ride.confirmed"))).outcome).toBe("rejected"); // wrong kind
    expect((await s.c.get(id)).plan.state).toBe("PENDING_CONFIRMATION"); // unchanged by the rejected event
  });

  it("no feasible recovery: both ride sources die → NEEDS_REPLAN with hard transport blocker and alternatives", async () => {
    const s = setup();
    const { id } = await toDispatched(s);
    // Dan's ride declined...
    const plan1 = (await s.c.get(id)).plan;
    ok(await s.c.ingest(id, ev(rideReqOf(plan1), "ride.declined", 1)), "ride declined");
    let cur = (await s.c.get(id)).plan;
    expect(cur.state).toBe("NEEDS_REPLAN");
    // ...recovery proposes paratransit; approve+execute; then paratransit is cancelled too
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept recovery");
    await approvePending(s, id);
    ok(await s.c.command(id, { type: "execute" }), "execute recovery");
    cur = (await s.c.get(id)).plan;
    expect(cur.state).toBe("PENDING_CONFIRMATION");
    ok(await s.c.ingest(id, ev(rideReqOf(cur), "ride.cancelled", 1)), "paratransit cancelled");
    cur = (await s.c.get(id)).plan;
    expect(cur.state).toBe("NEEDS_REPLAN");
    expect(cur.blockers.some((b) => b.rule === "transport")).toBe(true); // no recovery left
    expect((await s.c.command(id, { type: "accept_proposal" })).outcome).toBe("rejected");
    expect(cur.alternatives.map((a) => a.activityId)).toContain("circle");
  });

  it("revoked approval never dispatches, and an expired approval blocks the whole atomic execute", async () => {
    const s = setup();
    const created = await create(s);
    const id = created.plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept");
    const [ride, invite] = currentActions((await s.c.get(id)).plan);
    ok(await s.c.command(id, { type: "approve", actionId: ride.id, scope: ride.scope, expiresAt: s.at(HOUR) }), "approve ride");
    ok(await s.c.command(id, { type: "revoke", actionId: ride.id }), "revoke ride");
    ok(await s.c.command(id, { type: "approve", actionId: invite.id, scope: invite.scope, expiresAt: s.at(HOUR) }), "approve invite");
    const exec = await s.c.command(id, { type: "execute" });
    expect(exec.outcome).toBe("rejected");
    expect(s.provider.calls).toHaveLength(0); // nothing sent

    // expired path: re-approve with a short window, let it lapse, execute must be atomic-blocked
    const plan = (await s.c.get(id)).plan;
    const ride2 = currentActions(plan).find((a) => a.id === ride.id)!;
    ok(await s.c.command(id, { type: "approve", actionId: ride2.id, scope: ride2.scope, expiresAt: s.at(60_000) }), "re-approve short");
    s.advance(120_000);
    const exec2 = await s.c.command(id, { type: "execute" });
    expect(exec2.outcome).toBe("rejected");
    expect(exec2.reason).toMatch(/expired/);
    expect(s.provider.calls).toHaveLength(0);
  });

  it("provider unavailability (dispatch throws) keeps state AWAITING_APPROVAL and retry is deduped", async () => {
    const t = T0;
    let n = 0;
    const inner = createMockProvider();
    const flaky: ProviderPort = {
      dataSource: "mock",
      sendApprovedInvite: (i) => inner.sendApprovedInvite(i),
      requestApprovedRide: async (i) => {
        if (inner.calls.filter((x) => x.kind === "ride").length === 0) {
          await inner.requestApprovedRide(i); // reached the provider, then the connection died
          throw new Error("ECONNRESET");
        }
        return inner.requestApprovedRide(i);
      },
    };
    const c = createCoordinator({ provider: flaky, now: () => new Date(t), activities: CATALOG, newId: () => `sim-plan-${++n}` });
    const created = ok(await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }), "create");
    const id = created.plan.id;
    ok(await c.command(id, { type: "accept_proposal" }), "accept");
    for (const a of currentActions((await c.get(id)).plan)) ok(await c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(t + HOUR).toISOString() }), `approve ${a.id}`);
    const first = await c.command(id, { type: "execute" });
    expect(first.outcome).toBe("rejected");
    expect(first.reason).toMatch(/retry execute/);
    expect((await c.get(id)).plan.state).toBe("AWAITING_APPROVAL");
    const retry = ok(await c.command(id, { type: "execute" }), "retry");
    expect(retry.plan.state).toBe("PENDING_CONFIRMATION");
    expect(inner.calls.filter((x) => x.kind === "ride")).toHaveLength(1); // idempotency key reused, no double booking
  });

  it("failed intervention at dispatch (provider returns failed) triggers immediate NEEDS_REPLAN with recovery", async () => {
    const s = setup({ fail: (i) => i.recipientId === "dan" });
    const { id, exec } = await toDispatched(s);
    expect(exec.plan.state).toBe("NEEDS_REPLAN");
    const newRide = currentActions(exec.plan).find((a) => a.scope.kind === "ride")!;
    expect(newRide.scope.recipientId).toBe("paratransit");
    void id;
  });

  it("stale approvals (all expired past the 24h cap) dispatch nothing", async () => {
    const s = setup();
    const created = await create(s);
    const id = created.plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept");
    for (const a of currentActions((await s.c.get(id)).plan)) ok(await s.c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(2 * HOUR) }), `approve ${a.id}`);
    s.advance(25 * HOUR); // all approvals expired
    const exec = await s.c.command(id, { type: "execute" });
    expect(exec.outcome).toBe("rejected");
    expect(s.provider.calls).toHaveLength(0);
    expect((await s.c.get(id)).plan.state).toBe("AWAITING_APPROVAL");
  });

  it("preference change: proposed patch never mutates profile until confirmed", async () => {
    // prefersSmallGroups=false → no invite action (no social barrier); ride only.
    const s = setup();
    const { id, exec } = await toDispatched(s, { ...MAYA, prefersSmallGroups: false });
    expect(inviteReqOf(exec.plan)).toBeUndefined(); // no invite proposed
    ok(await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.confirmed")), "ride confirmed");
    expect((await s.c.get(id)).plan.state).toBe("READY"); // single dependency confirmed is enough
    ok(await s.c.command(id, { type: "complete", attended: true }), "complete");

    const fb = ok(await s.c.command(id, { type: "feedback", signals: ["too_crowded"] }), "feedback");
    const patch = fb.plan.preferencePatches[0];
    expect(patch).toMatchObject({ field: "prefersSmallGroups", from: false, to: true, status: "proposed" });
    expect(fb.plan.profile.prefersSmallGroups).toBe(false); // NOT applied yet
    expect(fb.plan.profileVersion).toBe(1);

    const applied = ok(await s.c.command(id, { type: "confirm_preference", patchId: patch.id }), "confirm");
    expect(applied.plan.profile.prefersSmallGroups).toBe(true);
    expect(applied.plan.profileVersion).toBe(2);

    // Documented engine behavior (finding F2 in the PR report): repeating the same
    // feedback signal after a patch was applied does NOT create a new patch row when
    // the field already matches the target — the first patch row itself flips status
    // as the profile evolved. What matters for reliability: feedback alone never
    // changes the profile, and the version history is explicit.
    const fb2 = ok(await s.c.command(id, { type: "feedback", signals: ["too_crowded"] }), "feedback2");
    expect(fb2.plan.profile.prefersSmallGroups).toBe(true); // unchanged by feedback alone
    expect(fb2.plan.profileVersion).toBe(2);
    // Every patch row is in a definite terminal-or-proposed state and the applied one
    // records exactly what changed.
    const appliedRow = fb2.plan.preferencePatches.find((x) => x.status === "applied")!;
    expect(appliedRow).toMatchObject({ field: "prefersSmallGroups", from: false, to: true });
  });

  it("double-confirm of a patch is idempotent (applied exactly once)", async () => {
    const s = setup();
    const { id } = await toReady(s);
    ok(await s.c.command(id, { type: "complete", attended: true }), "complete");
    const fb = ok(await s.c.command(id, { type: "feedback", signals: ["too_far"] }), "feedback");
    const patch = fb.plan.preferencePatches[0];
    expect(patch).toMatchObject({ field: "maxTravelMin", from: 30, to: 20 });
    ok(await s.c.command(id, { type: "confirm_preference", patchId: patch.id }), "confirm");
    const again = await s.c.command(id, { type: "confirm_preference", patchId: patch.id });
    expect(again.outcome).toBe("duplicate");
    expect(again.plan.profile.maxTravelMin).toBe(20); // applied exactly once
    expect(again.plan.profileVersion).toBe(2);
  });

  it("carried confirmed dependency survives a replan and is never re-sent", async () => {
    const s = setup();
    const { id, exec } = await toReady(s);
    const inviteAction = currentActions(exec.plan).find((a) => a.scope.kind === "invite")!;
    ok(await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.cancelled", 2)), "ride cancelled");
    const cur = (await s.c.get(id)).plan;
    expect(cur.state).toBe("NEEDS_REPLAN");
    const carriedInvite = currentActions(cur).find((a) => a.scope.kind === "invite")!;
    expect(carriedInvite.id).toBe(inviteAction.id); // same action survives
    expect(carriedInvite.status).toBe("dispatched"); // not re-proposed
    const dep = cur.dependencies.find((d) => d.actionId === carriedInvite.id)!;
    expect(dep.status).toBe("confirmed"); // acceptance evidence preserved
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept recovery");
    await approvePending(s, id); // only the NEW ride needs approval
    const exec2 = ok(await s.c.command(id, { type: "execute" }), "execute recovery");
    expect(exec2.plan.state).toBe("PENDING_CONFIRMATION");
    expect(s.provider.calls.filter((x) => x.kind === "invite")).toHaveLength(1); // Elaine not re-invited
  });
});

// ─── golden path & false-success detection ────────────────────────────────────

describe("Phase 2: offline golden path (repeatable)", () => {
  it("BLOCKED → alternative → approval → pending → READY → disruption → NEEDS_REPLAN → READY → COMPLETED", async () => {
    const s = setup();
    // 1. blocked start on an inaccessible activity, then switch to a feasible one
    const blocked = ok(await s.c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS }), "create loft");
    expect(blocked.plan.state).toBe("BLOCKED");
    expect(blocked.plan.blockers[0].rule).toBe("access");
    const alt = ok(await s.c.command(blocked.plan.id, { type: "choose_alternative", activityId: "workshop" }), "choose workshop");
    expect(alt.plan.state).toBe("PROPOSED");
    const id = blocked.plan.id;

    // 2. proposal → approval → dispatch; every dispatch must carry an approval id
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept");
    await approvePending(s, id);
    const exec = ok(await s.c.command(id, { type: "execute" }), "execute");
    expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
    expect(s.provider.calls.map((x) => x.kind).sort()).toEqual(["invite", "ride"]);
    for (const call of s.provider.calls) expect(call.approvalId).toBeTruthy();

    // 3. partial confirmation must NOT be READY (false-success check)
    ok(await s.c.ingest(id, ev(inviteReqOf(exec.plan)!, "invite.accepted")), "invite");
    const half = (await s.c.get(id)).plan;
    expect(half.state).toBe("PENDING_CONFIRMATION");
    expect(readyViolations(half).length).toBeGreaterThan(0);

    // 4. final confirmation → READY, invariant holds
    ok(await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.confirmed")), "ride");
    const ready = (await s.c.get(id)).plan;
    expect(ready.state).toBe("READY");
    expect(readyViolations(ready)).toEqual([]);

    // 5. disruption after READY → revoked → recovery → READY again (invite carried over)
    const cancelled = ok(await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.cancelled", 2)), "ride cancelled");
    expect(cancelled.plan.state).toBe("NEEDS_REPLAN");
    expect(cancelled.events.map((e) => e.type)).toContain("plan.ready_revoked");
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept recovery");
    await approvePending(s, id);
    const exec2 = ok(await s.c.command(id, { type: "execute" }), "execute recovery");
    expect(exec2.plan.state).toBe("PENDING_CONFIRMATION");
    ok(await s.c.ingest(id, ev(rideReqOf(exec2.plan), "ride.confirmed")), "new ride confirmed");
    expect((await s.c.get(id)).plan.state).toBe("READY");
    expect(s.provider.calls.filter((x) => x.kind === "invite")).toHaveLength(1); // invite never re-sent

    // 6. complete → self-reported outcome only, never provider-claimed attendance
    const done = ok(await s.c.command(id, { type: "complete", attended: true }), "complete");
    expect(done.plan.outcome).toEqual({ attended: true, source: "self_reported" });
    // closed plan refuses further commands
    expect((await s.c.command(id, { type: "execute" })).outcome).toBe("rejected");
  });

  it("determinism: two identical command sequences produce identical plans (except ids/timestamps)", async () => {
    const run = async () => {
      const s = setup();
      const { id } = await toReady(s);
      const p = (await s.c.get(id)).plan;
      return JSON.stringify({
        state: p.state, version: p.version,
        actions: p.actions.map((a) => [a.scope.kind, a.scope.recipientId, a.status]),
        deps: p.dependencies.map((d) => [d.kind, d.status, d.lastSequence]),
        approvals: p.approvals.map((x) => [x.actionId, x.revoked]),
      });
    };
    expect(await run()).toBe(await run());
  });

  it("event log seq is strictly increasing and every plan schema-parses across a chaotic session", async () => {
    const s = setup();
    const created = await create(s);
    const id = created.plan.id;
    // chaotic but deterministic sequence
    await s.c.ingest(id, ev("forged", "ride.confirmed", 1)); // rejected
    ok(await s.c.command(id, { type: "accept_proposal" }), "accept");
    await s.c.command(id, { type: "execute" }); // rejected (no approvals)
    await approvePending(s, id);
    const exec = ok(await s.c.command(id, { type: "execute" }), "execute");
    await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.confirmed", 1, { idempotencyKey: "k1" }));
    await s.c.ingest(id, ev(rideReqOf(exec.plan), "ride.confirmed", 1, { idempotencyKey: "k1" })); // duplicate
    await s.c.ingest(id, ev(inviteReqOf(exec.plan)!, "invite.accepted", 1));
    await s.c.ingest(id, ev(inviteReqOf(exec.plan)!, "invite.declined", 0)); // stale sequence → ignored
    const final = await s.c.get(id);
    expect(final.events.map((e) => e.seq)).toEqual(final.events.map((_, i) => i + 1));
    CoordinationPlan.parse(final.plan);
    expect(final.plan.state).toBe("READY");
  });
});
