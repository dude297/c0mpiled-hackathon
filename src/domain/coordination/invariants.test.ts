import { describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activities";
import { CommandResult, type CoordinationPlan, type Contact, type PlanCommand, type PlanState, type Profile, type ProviderEvent } from "@/lib/schema";
import { createCoordinator, currentActions, currentDeps, readyViolations } from "./coordinator";
import { PARATRANSIT_ID } from "./planner";
import { createMockProvider, type DispatchInput, type ProviderPort } from "./provider";

// Adversarial invariant tests. Synthetic fixtures only (independent of the human-owned ACTIVITIES catalog).
const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const LOFT: Activity = { id: "loft", name: "Upstairs Pottery Loft", tags: ["crafts"], day: "Tue", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: false, groupSize: "small", noisy: false, hearingLoop: false };
const CIRCLE: Activity = { id: "circle", name: "Library Knitting Circle", tags: ["crafts"], day: "Wed", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false };
// Same day/slot as WORKSHOP, different venue: used to probe cross-activity carry-over.
const FAIR: Activity = { id: "fair", name: "Saturday Craft Fair", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 0, travelMin: { bus: 50, family: 20, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const CATALOG = [WORKSHOP, LOFT, CIRCLE];

const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];

const T0 = Date.parse("2026-10-17T12:00:00Z");
const HOUR = 3600_000;

type Call = DispatchInput & { kind: "invite" | "ride" };

// Counts every call that reaches the provider port (before the mock's own idempotency dedupe).
function setup(opts: { catalog?: Activity[]; inner?: ProviderPort } = {}) {
  let t = T0;
  let n = 0;
  const inner = opts.inner ?? createMockProvider();
  const raw: Call[] = [];
  const provider: ProviderPort = {
    dataSource: inner.dataSource,
    sendApprovedInvite: (i) => (raw.push({ ...i, kind: "invite" }), inner.sendApprovedInvite(i)),
    requestApprovedRide: (i) => (raw.push({ ...i, kind: "ride" }), inner.requestApprovedRide(i)),
  };
  const c = createCoordinator({ provider, now: () => new Date(t), activities: opts.catalog ?? CATALOG, newId: () => `plan-${++n}` });
  return { c, raw, advance: (ms: number) => (t += ms), at: (ms: number) => new Date(t + ms).toISOString() };
}
type S = ReturnType<typeof setup>;

const ok = (r: CommandResult) => CommandResult.parse(r);
let evn = 0;
const ev = (requestId: string, type: ProviderEvent["type"], sequence = 1, extra: Partial<ProviderEvent> = {}): ProviderEvent => ({ eventId: `inv-ev-${++evn}`, requestId, sequence, type, actor: "demo", ...extra });
const act = (p: CoordinationPlan, kind: "ride" | "invite") => currentActions(p).find((a) => a.scope.kind === kind)!;
const depOf = (p: CoordinationPlan, actionId: string) => p.dependencies.find((d) => d.actionId === actionId)!;

async function approvePending(s: S, id: string) {
  for (const a of currentActions((await s.c.get(id)).plan).filter((x) => x.status === "proposed" || x.status === "revoked")) {
    const r = ok(await s.c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(HOUR) }));
    expect(r.outcome).toBe("applied");
  }
  return (await s.c.get(id)).plan;
}

// Confirms every current dependency still waiting on the provider.
async function confirmRequested(s: S, id: string) {
  for (const a of currentActions((await s.c.get(id)).plan)) {
    const d = depOf((await s.c.get(id)).plan, a.id);
    if (d.status !== "requested") continue;
    ok(await s.c.ingest(id, ev(a.providerRequestId!, a.scope.kind === "ride" ? "ride.confirmed" : "invite.accepted", d.lastSequence + 1)));
  }
  return (await s.c.get(id)).plan;
}

async function toReady(s: S, profile = MAYA) {
  const id = ok(await s.c.create({ profile, activityId: "workshop", contacts: CONTACTS })).plan.id;
  ok(await s.c.command(id, { type: "accept_proposal" }));
  await approvePending(s, id);
  ok(await s.c.command(id, { type: "execute" }));
  const plan = await confirmRequested(s, id);
  expect(plan.state).toBe("READY");
  return { id, plan };
}

async function toNeedsReplan(s: S) {
  const { id, plan } = await toReady(s);
  const r = ok(await s.c.ingest(id, ev(act(plan, "ride").providerRequestId!, "ride.cancelled", 2)));
  expect(r.plan.state).toBe("NEEDS_REPLAN");
  return { id, oldPlan: plan, plan: r.plan };
}

async function toCompleted(s: S) {
  const id = ok(await s.c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS })).plan.id;
  ok(await s.c.command(id, { type: "choose_alternative", activityId: "circle" }));
  ok(await s.c.command(id, { type: "accept_proposal" }));
  const r = ok(await s.c.command(id, { type: "complete", attended: true }));
  expect(r.plan.state).toBe("COMPLETED");
  return id;
}

describe("golden coordination loop (end-to-end trace)", () => {
  it("blocked → alternative → consent → dispatch → evidence → disruption → recovery → feedback → preference", async () => {
    // Deviation from the brief: an invite intervention only exists when prefersSmallGroups=true (the "social"
    // soft barrier), so the golden profile keeps it true. "too_crowded" is then a no-op and "too_far" drives the
    // patch. The prefersSmallGroups=false → true path is covered in coordinator.test.ts.
    const s = setup();

    const created = ok(await s.c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS }));
    const id = created.plan.id;
    expect(created.plan.state).toBe("BLOCKED");
    expect(created.plan.blockers).toEqual([expect.objectContaining({ rule: "access", severity: "hard" })]);
    expect(created.plan.actions).toEqual([]);
    expect(created.plan.alternatives.map((a) => a.activityId)).toContain("workshop");

    const alt = ok(await s.c.command(id, { type: "choose_alternative", activityId: "workshop" }));
    expect(alt.plan.state).toBe("PROPOSED");
    expect(alt.plan.blockers).toEqual([]);
    expect(currentActions(alt.plan).map((a) => [a.scope.kind, a.scope.recipientId, a.status])).toEqual([["ride", "dan", "proposed"], ["invite", "elaine", "proposed"]]);
    expect(CONTACTS.find((x) => x.id === act(alt.plan, "ride").scope.recipientId)!.canDrive).toBe(true);

    expect(ok(await s.c.command(id, { type: "accept_proposal" })).plan.state).toBe("AWAITING_APPROVAL");

    const early = ok(await s.c.command(id, { type: "execute" }));
    expect(early.outcome).toBe("rejected");
    expect(early.plan.state).toBe("AWAITING_APPROVAL");
    expect(s.raw).toHaveLength(0);

    for (const a of currentActions(alt.plan)) {
      const r = ok(await s.c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(HOUR) }));
      expect(r.outcome).toBe("applied");
      expect(r.plan.approvals.at(-1)).toMatchObject({ actionId: a.id, scope: a.scope, revoked: false });
    }
    expect(s.raw).toHaveLength(0); // approval alone sends nothing

    const exec = ok(await s.c.command(id, { type: "execute" }));
    expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
    expect(exec.plan.dependencies.map((d) => d.status)).toEqual(["requested", "requested"]);
    expect(readyViolations(exec.plan).length).toBeGreaterThan(0);
    expect(s.raw.map((x) => [x.kind, x.recipientId])).toEqual([["ride", "dan"], ["invite", "elaine"]]);
    for (const call of s.raw) expect(exec.plan.approvals.find((x) => x.id === call.approvalId)!.scope.recipientId).toBe(call.recipientId);

    const inviteId = act(exec.plan, "invite").id;
    const oldRide = act(exec.plan, "ride");
    const half = ok(await s.c.ingest(id, ev(act(exec.plan, "invite").providerRequestId!, "invite.accepted")));
    expect(half.outcome).toBe("applied");
    expect(half.plan.state).toBe("PENDING_CONFIRMATION");

    const ready = ok(await s.c.ingest(id, ev(oldRide.providerRequestId!, "ride.confirmed")));
    expect(ready.plan.state).toBe("READY");
    expect(readyViolations(ready.plan)).toEqual([]);

    const cancelled = ok(await s.c.ingest(id, ev(oldRide.providerRequestId!, "ride.cancelled", 2)));
    expect(cancelled.plan.state).toBe("NEEDS_REPLAN");
    expect(cancelled.events.map((e) => e.type)).toContain("plan.ready_revoked");
    const newRide = act(cancelled.plan, "ride");
    expect(newRide.id).not.toBe(oldRide.id);
    expect(newRide.scope.recipientId).not.toBe("dan");
    expect(newRide.scope.recipientId).toBe(PARATRANSIT_ID);
    expect(newRide.status).toBe("proposed");
    expect(act(cancelled.plan, "invite").id).toBe(inviteId); // carried over
    expect(depOf(cancelled.plan, inviteId).status).toBe("confirmed");
    expect(cancelled.plan.actions.find((a) => a.id === oldRide.id)!.status).toBe("superseded");

    expect(ok(await s.c.command(id, { type: "accept_proposal" })).plan.state).toBe("AWAITING_APPROVAL");
    const stale = ok(await s.c.command(id, { type: "execute" }));
    expect(stale.outcome).toBe("rejected"); // old approval doesn't cover the new ride
    expect(stale.reason).toContain(newRide.id);
    expect(s.raw).toHaveLength(2);

    ok(await s.c.command(id, { type: "approve", actionId: newRide.id, scope: newRide.scope, expiresAt: s.at(HOUR) }));
    const exec2 = ok(await s.c.command(id, { type: "execute" }));
    expect(exec2.plan.state).toBe("PENDING_CONFIRMATION");
    expect(s.raw.map((x) => [x.kind, x.recipientId])).toEqual([["ride", "dan"], ["invite", "elaine"], ["ride", PARATRANSIT_ID]]);

    const ready2 = ok(await s.c.ingest(id, ev(act(exec2.plan, "ride").providerRequestId!, "ride.confirmed")));
    expect(ready2.plan.state).toBe("READY");
    expect(readyViolations(ready2.plan)).toEqual([]);

    const done = ok(await s.c.command(id, { type: "complete", attended: true }));
    expect(done.plan.state).toBe("COMPLETED");
    expect(done.plan.outcome).toEqual({ attended: true, source: "self_reported" });

    const fb = ok(await s.c.command(id, { type: "feedback", signals: ["too_crowded", "too_far"] }));
    expect(fb.plan.preferencePatches).toEqual([expect.objectContaining({ field: "maxTravelMin", from: 30, to: 20, status: "proposed" })]);
    expect(fb.plan.profile).toEqual(MAYA); // proposal only
    expect(fb.plan.profileVersion).toBe(1);

    const conf = ok(await s.c.command(id, { type: "confirm_preference", patchId: fb.plan.preferencePatches[0].id }));
    expect(conf.plan.profile).toEqual({ ...MAYA, maxTravelMin: 20 });
    expect(conf.plan.profileVersion).toBe(2);
    expect(conf.plan.preferencePatches[0].status).toBe("applied");

    // Provider totals: 2 rides + exactly 1 invite (Elaine never re-invited).
    expect(s.raw).toHaveLength(3);
    expect(s.raw.filter((x) => x.kind === "invite")).toHaveLength(1);

    const { events } = (await s.c.get(id));
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.map((e) => e.type)).toEqual([
      "plan.created", "plan.blocked",
      "command.choose_alternative", "plan.proposed",
      "command.accept_proposal",
      "command.execute",
      "action.approved", "action.approved",
      "ride.requested", "invite.requested",
      "invite.accepted",
      "ride.confirmed", "plan.ready",
      "ride.cancelled", "plan.ready_revoked", "actions.superseded", "plan.proposed", "plan.replan_required",
      "command.accept_proposal",
      "command.execute",
      "action.approved",
      "ride.requested",
      "ride.confirmed", "plan.ready",
      "plan.completed",
      "feedback.preference_proposed",
      "preference.updated",
    ]);
    expect(events.filter((e) => e.type === "command.execute").map((e) => e.outcome)).toEqual(["rejected", "rejected"]);
  });
});

describe("state × command matrix", () => {
  const builders: Record<PlanState, (s: S) => Promise<string>> = {
    BLOCKED: async (s) => (await s.c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS })).plan.id,
    PROPOSED: async (s) => (await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id,
    AWAITING_APPROVAL: async (s) => {
      const id = await builders.PROPOSED(s);
      await s.c.command(id, { type: "accept_proposal" });
      return id;
    },
    PENDING_CONFIRMATION: async (s) => {
      const id = await builders.AWAITING_APPROVAL(s);
      await approvePending(s, id);
      await s.c.command(id, { type: "execute" });
      return id;
    },
    READY: async (s) => (await toReady(s)).id,
    NEEDS_REPLAN: async (s) => (await toNeedsReplan(s)).id,
    COMPLETED: async (s) => {
      const id = await builders.READY(s);
      await s.c.command(id, { type: "complete", attended: true });
      return id;
    },
    CANCELLED: async (s) => {
      const id = await builders.PROPOSED(s);
      await s.c.command(id, { type: "cancel" });
      return id;
    },
  };

  const commands: Record<PlanCommand["type"], (p: CoordinationPlan, s: S) => PlanCommand> = {
    accept_proposal: () => ({ type: "accept_proposal" }),
    approve: (p, s) => {
      const a = currentActions(p).find((x) => x.status === "proposed") ?? currentActions(p)[0];
      return a
        ? { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(HOUR) }
        : { type: "approve", actionId: "forged", scope: { kind: "ride", activityId: "workshop", recipientId: "dan", sharedFields: [], when: "Sat afternoon" }, expiresAt: s.at(HOUR) };
    },
    revoke: (p) => ({ type: "revoke", actionId: currentActions(p)[0]?.id ?? "forged" }),
    execute: () => ({ type: "execute" }),
    choose_alternative: (p) => ({ type: "choose_alternative", activityId: p.alternatives[0]?.activityId ?? "circle" }),
    complete: () => ({ type: "complete", attended: true }),
    cancel: () => ({ type: "cancel" }),
    feedback: () => ({ type: "feedback", signals: ["enjoyed"] }),
    confirm_preference: () => ({ type: "confirm_preference", patchId: "nope" }),
    reject_preference: () => ({ type: "reject_preference", patchId: "nope" }),
  };

  // Everything not listed is "rejected".
  const allowed: Partial<Record<PlanState, Partial<Record<PlanCommand["type"], [CommandResult["outcome"], PlanState]>>>> = {
    BLOCKED: { choose_alternative: ["applied", "PROPOSED"], cancel: ["applied", "CANCELLED"] },
    PROPOSED: { accept_proposal: ["applied", "AWAITING_APPROVAL"], choose_alternative: ["applied", "PROPOSED"], cancel: ["applied", "CANCELLED"] },
    AWAITING_APPROVAL: { approve: ["applied", "AWAITING_APPROVAL"], cancel: ["applied", "CANCELLED"] },
    PENDING_CONFIRMATION: { execute: ["duplicate", "PENDING_CONFIRMATION"], cancel: ["applied", "CANCELLED"] },
    READY: { execute: ["duplicate", "READY"], complete: ["applied", "COMPLETED"], cancel: ["applied", "CANCELLED"] },
    NEEDS_REPLAN: { accept_proposal: ["applied", "AWAITING_APPROVAL"], choose_alternative: ["applied", "PROPOSED"], cancel: ["applied", "CANCELLED"] },
    COMPLETED: { feedback: ["applied", "COMPLETED"] },
  };

  for (const state of Object.keys(builders) as PlanState[]) {
    for (const type of Object.keys(commands) as PlanCommand["type"][]) {
      const [outcome, nextState] = allowed[state]?.[type] ?? ["rejected", state];
      it(`${type} in ${state} → ${outcome} (${nextState}), never a false READY, never a dispatch`, async () => {
        const s = setup();
        const id = await builders[state](s);
        const before = (await s.c.get(id)).plan;
        expect(before.state).toBe(state);
        const calls = s.raw.length;

        const r = ok(await s.c.command(id, commands[type](before, s)));
        expect([r.outcome, r.plan.state]).toEqual([outcome, nextState]);
        expect(s.raw).toHaveLength(calls);
        if (r.plan.state === "READY") expect(readyViolations(r.plan)).toEqual([]);
        if (r.outcome !== "applied") expect(r.plan).toEqual(before); // refusals never mutate the plan
        expect((await s.c.get(id)).plan).toEqual(r.plan);
        expect(r.events).toHaveLength(r.outcome === "applied" ? r.events.length : 1);
      });
    }
  }
});

describe("adversarial approvals and revocations", () => {
  it("approving an action id from a superseded version after replan is rejected and sends nothing", async () => {
    const s = setup();
    const { id, oldPlan } = await toNeedsReplan(s);
    ok(await s.c.command(id, { type: "accept_proposal" }));
    const old = act(oldPlan, "ride");
    const r = ok(await s.c.command(id, { type: "approve", actionId: old.id, scope: old.scope, expiresAt: s.at(HOUR) }));
    expect(r.outcome).toBe("rejected");
    expect(r.reason).toMatch(/superseded/);
    expect(r.plan.approvals.filter((a) => a.actionId === old.id)).toHaveLength(1); // only the original one
    const calls = s.raw.length;
    expect(ok(await s.c.command(id, { type: "execute" })).outcome).toBe("rejected");
    expect(s.raw).toHaveLength(calls);
  });

  it("replaying an approve command after revoke creates a fresh approval; the revoked one stays revoked and unused", async () => {
    const s = setup();
    const id = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }));
    const plan = await approvePending(s, id);
    const ride = act(plan, "ride");
    const replay: PlanCommand = { type: "approve", actionId: ride.id, scope: ride.scope, expiresAt: s.at(HOUR) };
    ok(await s.c.command(id, { type: "revoke", actionId: ride.id }));

    // A replay whose window has since lapsed is refused.
    s.advance(2 * HOUR);
    expect(ok(await s.c.command(id, replay)).outcome).toBe("rejected");
    expect(ok(await s.c.command(id, { type: "execute" })).outcome).toBe("rejected");
    expect(s.raw).toHaveLength(0);

    // No nonce in the contract: an in-window replay is indistinguishable from a new approval (no auth by design).
    const fresh = ok(await s.c.command(id, { ...replay, expiresAt: s.at(HOUR) }));
    expect(fresh.outcome).toBe("applied");
    const rideApprovals = fresh.plan.approvals.filter((a) => a.actionId === ride.id);
    expect(rideApprovals.map((a) => a.revoked)).toEqual([true, false]);
    expect(act(fresh.plan, "ride").approvalId).toBe(rideApprovals[1].id);
    // The invite's approval also expired while waiting; renew it, then dispatch.
    await approvePending(s, id);
    const exec = ok(await s.c.command(id, { type: "execute" }));
    expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
    expect(s.raw.find((x) => x.kind === "ride")!.approvalId).toBe(rideApprovals[1].id);
    expect(s.raw.some((x) => x.approvalId === rideApprovals[0].id)).toBe(false);
  });

  it("revoking a carried-over (already dispatched) action after replan is refused and changes nothing", async () => {
    const s = setup();
    const { id, oldPlan, plan } = await toNeedsReplan(s);
    const invite = act(plan, "invite");
    for (const state of ["NEEDS_REPLAN", "AWAITING_APPROVAL"] as const) {
      if (state === "AWAITING_APPROVAL") ok(await s.c.command(id, { type: "accept_proposal" }));
      const before = (await s.c.get(id)).plan;
      expect(before.state).toBe(state);
      const r = ok(await s.c.command(id, { type: "revoke", actionId: invite.id }));
      expect(r.outcome).toBe("rejected");
      expect(r.reason).toMatch(/Already sent/);
      expect(r.plan).toEqual(before);
      expect(depOf(r.plan, invite.id).status).toBe("confirmed");
    }
    // Revoking the superseded ride is refused too.
    expect(ok(await s.c.command(id, { type: "revoke", actionId: act(oldPlan, "ride").id })).outcome).toBe("rejected");
  });
});

describe("state isolation", () => {
  it("returned plans are clones: mutating results or inputs never touches stored state", async () => {
    const s = setup();
    const profile = structuredClone(MAYA);
    const contacts = structuredClone(CONTACTS);
    const r = ok(await s.c.create({ profile, activityId: "workshop", contacts }));
    const id = r.plan.id;
    const snapshot = (await s.c.get(id));

    r.plan.state = "READY";
    r.plan.actions[0].status = "dispatched";
    r.plan.dependencies.forEach((d) => (d.status = "confirmed"));
    r.events.push({ ...r.events[0], type: "forged" });
    profile.maxTravelMin = 120;
    contacts[0].canDrive = true;
    const got = (await s.c.get(id));
    got.plan.approvals.push({ id: "forged", actionId: got.plan.actions[0].id, scope: got.plan.actions[0].scope, approvedBy: "user", approvedAt: s.at(0), expiresAt: s.at(HOUR), revoked: false });
    got.events.length = 0;

    expect((await s.c.get(id))).toEqual(snapshot);
    ok(await s.c.command(id, { type: "accept_proposal" }));
    expect(ok(await s.c.command(id, { type: "execute" })).outcome).toBe("rejected"); // forged approval did not leak in
    expect(s.raw).toHaveLength(0);
  });

  it("events for plan A carrying plan B's requestId are rejected and leave both plans untouched", async () => {
    const s = setup();
    const a = await toReady(s);
    const bId = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    ok(await s.c.command(bId, { type: "accept_proposal" }));
    await approvePending(s, bId);
    const b = ok(await s.c.command(bId, { type: "execute" })).plan;
    const [beforeA, beforeB] = [(await s.c.get(a.id)).plan, (await s.c.get(bId)).plan];

    for (const [target, other] of [[a.id, b], [bId, a.plan]] as const) {
      const r = ok(await s.c.ingest(target, ev(act(other, "ride").providerRequestId!, "ride.cancelled", 9)));
      expect(r.outcome).toBe("rejected");
    }
    expect((await s.c.get(a.id)).plan).toEqual(beforeA);
    expect((await s.c.get(bId)).plan).toEqual(beforeB);
    expect(beforeA.state).toBe("READY");
    expect(beforeB.state).toBe("PENDING_CONFIRMATION");
  });

  // A rejected (forged/mistyped) event must not burn its keys, otherwise it could pre-empt the genuine callback.
  it("a rejected event does not burn its eventId; the genuine callback with that id still applies", async () => {
    const s = setup();
    const id = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }));
    await approvePending(s, id);
    const plan = ok(await s.c.command(id, { type: "execute" })).plan;
    const rid = act(plan, "invite").providerRequestId!;
    expect(ok(await s.c.ingest(id, ev(rid, "ride.confirmed", 1, { eventId: "burn" }))).outcome).toBe("rejected");
    const r = ok(await s.c.ingest(id, ev(rid, "invite.accepted", 1, { eventId: "burn" })));
    expect(r.outcome).toBe("applied");
    expect(depOf(r.plan, act(plan, "invite").id).status).toBe("confirmed");
    expect(ok(await s.c.ingest(id, ev(rid, "invite.accepted", 2, { eventId: "burn" }))).outcome).toBe("duplicate");
  });
});

describe("concurrency and ordering", () => {
  async function pending(s: S) {
    const id = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }));
    await approvePending(s, id);
    const plan = ok(await s.c.command(id, { type: "execute" })).plan;
    ok(await s.c.ingest(id, ev(act(plan, "invite").providerRequestId!, "invite.accepted")));
    return { id, rid: act(plan, "ride").providerRequestId! };
  }

  it("interleaved confirm(seq1) + cancel(seq2) for one dependency always ends NEEDS_REPLAN, in either arrival order", async () => {
    for (const order of ["confirm-first", "cancel-first"] as const) {
      const s = setup();
      const { id, rid } = await pending(s);
      const confirm = ev(rid, "ride.confirmed", 1);
      const cancel = ev(rid, "ride.cancelled", 2);
      const [first, second] = order === "confirm-first" ? [confirm, cancel] : [cancel, confirm];
      const rs = (await Promise.all([s.c.ingest(id, first), s.c.ingest(id, second)])).map(ok);
      if (order === "confirm-first") expect(rs.map((r) => [r.outcome, r.plan.state])).toEqual([["applied", "READY"], ["applied", "NEEDS_REPLAN"]]);
      else expect(rs.map((r) => [r.outcome, r.plan.state])).toEqual([["applied", "NEEDS_REPLAN"], ["ignored", "NEEDS_REPLAN"]]);
      const final = (await s.c.get(id)).plan;
      expect(final.state).toBe("NEEDS_REPLAN");
      expect(final.dependencies.find((d) => d.actionId.includes(":ride:dan"))!.status).toBe("cancelled");
    }
  });

  it("conflicting events with the same sequence: first wins, second is stale", async () => {
    const s = setup();
    const { id, rid } = await pending(s);
    const rs = (await Promise.all([s.c.ingest(id, ev(rid, "ride.cancelled", 1)), s.c.ingest(id, ev(rid, "ride.confirmed", 1))])).map(ok);
    expect(rs.map((r) => r.outcome)).toEqual(["applied", "ignored"]);
    expect((await s.c.get(id)).plan.state).toBe("NEEDS_REPLAN");
  });

  it("events for the previous activity's dispatched requests are ignored after choose_alternative", async () => {
    const s = setup();
    const id = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }));
    await approvePending(s, id);
    const exec = ok(await s.c.command(id, { type: "execute" })).plan;
    const ride = act(exec, "ride").providerRequestId!;
    const invite = act(exec, "invite").providerRequestId!;
    expect(ok(await s.c.ingest(id, ev(invite, "invite.declined"))).plan.state).toBe("NEEDS_REPLAN");

    const switched = ok(await s.c.command(id, { type: "choose_alternative", activityId: "circle" }));
    expect(switched.plan.state).toBe("PROPOSED");
    expect(currentActions(switched.plan)).toEqual([]);

    const late = ok(await s.c.ingest(id, ev(ride, "ride.confirmed", 1)));
    expect(late.outcome).toBe("ignored");
    expect(late.plan).toEqual({ ...switched.plan, updatedAt: late.plan.updatedAt });

    expect(ok(await s.c.command(id, { type: "accept_proposal" })).plan.state).toBe("READY");
    const late2 = ok(await s.c.ingest(id, ev(ride, "ride.cancelled", 2)));
    expect(late2.outcome).toBe("ignored");
    expect(late2.plan.state).toBe("READY");
    expect(s.raw).toHaveLength(2);
  });
});

describe("feedback and preferences", () => {
  it("duplicate signals in one feedback call produce one patch per field", async () => {
    const s = setup();
    const id = await toCompleted(s);
    const r = ok(await s.c.command(id, { type: "feedback", signals: ["too_far", "too_far", "too_expensive", "too_expensive", "enjoyed"] }));
    expect(r.plan.preferencePatches.map((p) => p.field)).toEqual(["maxTravelMin", "budgetPerWeek"]);
    expect(new Set(r.plan.preferencePatches.map((p) => p.id)).size).toBe(2);
    expect(r.plan.profile).toEqual(MAYA);
  });

  it("confirm_preference is rejected as stale after another patch changed the same field", async () => {
    const s = setup();
    const id = await toCompleted(s);
    const p1 = ok(await s.c.command(id, { type: "feedback", signals: ["too_far"] })).plan.preferencePatches[0];
    const p2 = ok(await s.c.command(id, { type: "feedback", signals: ["too_far"] })).plan.preferencePatches[1];
    expect([p1.from, p2.from]).toEqual([30, 30]);
    expect(ok(await s.c.command(id, { type: "confirm_preference", patchId: p1.id })).plan.profile.maxTravelMin).toBe(20);

    const stale = ok(await s.c.command(id, { type: "confirm_preference", patchId: p2.id }));
    expect(stale.outcome).toBe("rejected");
    expect(stale.reason).toMatch(/Stale/);
    expect(stale.plan.profile.maxTravelMin).toBe(20); // not 10, not double-applied
    expect(stale.plan.profileVersion).toBe(2);
    expect(stale.plan.preferencePatches[1].status).toBe("proposed");
    expect(ok(await s.c.command(id, { type: "reject_preference", patchId: p2.id })).plan.preferencePatches[1].status).toBe("rejected");
  });

  it("a patch id from another plan is unknown here", async () => {
    const s = setup();
    const a = await toCompleted(s);
    const b = await toCompleted(s);
    const patch = ok(await s.c.command(b, { type: "feedback", signals: ["too_far"] })).plan.preferencePatches[0];
    const r = ok(await s.c.command(a, { type: "confirm_preference", patchId: patch.id }));
    expect(r.outcome).toBe("rejected");
    expect(r.plan.profileVersion).toBe(1);
    expect((await s.c.get(b)).plan.profile.maxTravelMin).toBe(30);
  });
});

describe("bugs found", () => {
  // BUG: carry-over matches on scope {kind, recipientId, sharedFields, when} only, not on the activity. After
  // choose_alternative from NEEDS_REPLAN to a different activity in the same slot ("Sat afternoon"), Elaine's
  // confirmed invite to the Workshop is carried over as "confirmed" for the Craft Fair; she is never invited to the
  // Fair, yet the plan reaches READY. Sequence: workshop READY → ride.cancelled(seq 2) → NEEDS_REPLAN →
  // choose_alternative "fair" → invite action reused (dep confirmed) → accept → approve ride → execute (ride only)
  // → ride.confirmed → READY with a single invite ever sent.
  // Fixed: ActionScope now includes activityId.
  it("a confirmed invite for one activity does not count as confirmation for a different activity in the same slot", async () => {
    const s = setup({ catalog: [...CATALOG, FAIR] });
    const { id, plan } = await toNeedsReplan(s);
    expect(plan.alternatives.map((a) => a.activityId)).toContain("fair");
    ok(await s.c.command(id, { type: "choose_alternative", activityId: "fair" }));
    ok(await s.c.command(id, { type: "accept_proposal" }));
    await approvePending(s, id);
    ok(await s.c.command(id, { type: "execute" }));
    const final = await confirmRequested(s, id);
    expect(final.state).toBe("READY");
    // Elaine must have been asked about the Fair, not just the Workshop.
    expect(s.raw.filter((x) => x.kind === "invite" && x.recipientId === "elaine")).toHaveLength(2);
  });

  // BUG: a dispatch that throws (outcome unknown; the doc says "keep it approved; retry reuses the same key") is
  // silently superseded if another action in the same execute fails, and the replan re-proposes the same recipient
  // under a new idempotency key (planId:v2:...). The retry is then a second, non-deduped invite.
  // Sequence: workshop, provider fails Dan's ride and the invite to Elaine reaches the provider then throws →
  // NEEDS_REPLAN → accept → approve → execute → Elaine receives a second invite with key plan-1:v2:invite:elaine.
  // Fixed: an unknown outcome keeps the plan in AWAITING_APPROVAL (no replan); the retry reuses the original key,
  // and the later replan carries the in-flight invite over instead of proposing it again.
  it("an invite whose dispatch outcome was unknown is not re-sent under a new idempotency key after replan", async () => {
    const inner = createMockProvider({ fail: (i) => i.recipientId === "dan" });
    let threw = false;
    const flaky: ProviderPort = {
      dataSource: "mock",
      requestApprovedRide: (i) => inner.requestApprovedRide(i),
      sendApprovedInvite: async (i) => {
        const r = await inner.sendApprovedInvite(i);
        if (!threw) {
          threw = true;
          throw new Error("timeout after delivery");
        }
        return r;
      },
    };
    const s = setup({ inner: flaky });
    const id = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    ok(await s.c.command(id, { type: "accept_proposal" }));
    await approvePending(s, id);
    const first = ok(await s.c.command(id, { type: "execute" }));
    expect(first.plan.state).toBe("AWAITING_APPROVAL");
    expect(first.outcome).toBe("rejected");
    const retry = ok(await s.c.command(id, { type: "execute" }));
    expect(retry.plan.state).toBe("NEEDS_REPLAN"); // Dan's ride failed; the invite is now known to be in flight
    expect(act(retry.plan, "invite").scope.recipientId).toBe("elaine");
    expect(act(retry.plan, "invite").status).toBe("dispatched"); // carried over, not re-proposed
    ok(await s.c.command(id, { type: "accept_proposal" }));
    await approvePending(s, id);
    ok(await s.c.command(id, { type: "execute" }));
    expect(currentDeps((await s.c.get(id)).plan).length).toBeGreaterThan(0);
    expect(inner.calls.filter((x) => x.kind === "invite" && x.recipientId === "elaine")).toHaveLength(1);
  });
});
