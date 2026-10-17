import { describe, expect, it, vi } from "vitest";
import type { Activity } from "@/domain/activities";
import { CommandResult, CoordinationPlan, CreatePlanInput, type ActionScope, type Contact, type Profile, type ProviderEvent } from "@/lib/schema";
import { PROVIDER_TIMEOUT_MS, createCoordinator, currentActions, readyViolations } from "./coordinator";
import { PARATRANSIT_ID, softCount } from "./planner";
import { createMockProvider, type ProviderPort } from "./provider";

// Synthetic fixtures (fictional), independent of the human-owned activity catalog.
const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const LOFT: Activity = { id: "loft", name: "Upstairs Pottery Loft", tags: ["crafts"], day: "Tue", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: false, groupSize: "small", noisy: false, hearingLoop: false };
const CIRCLE: Activity = { id: "circle", name: "Library Knitting Circle", tags: ["crafts"], day: "Wed", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false };
const CATALOG = [WORKSHOP, LOFT, CIRCLE];

const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];

const T0 = Date.parse("2026-10-17T12:00:00Z");

function setup(opts: { provider?: ProviderPort & { calls?: unknown[] }; profile?: Profile; contacts?: Contact[] } = {}) {
  let t = T0;
  let n = 0;
  const provider = opts.provider ?? createMockProvider();
  const c = createCoordinator({ provider, now: () => new Date(t), activities: CATALOG, newId: () => `plan-${++n}` });
  return { c, provider, advance: (ms: number) => (t += ms), at: (ms: number) => new Date(t + ms).toISOString() };
}

const HOUR = 3600_000;
const ok = (r: CommandResult) => {
  CommandResult.parse(r); // every response honors the published contract
  return r;
};

async function approveAll(c: ReturnType<typeof setup>["c"], plan: CoordinationPlan, expiresAt: string) {
  let last: CommandResult | undefined;
  for (const a of currentActions(plan).filter((x) => x.status === "proposed" || x.status === "revoked")) {
    last = ok(await c.command(plan.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt }));
    expect(last.outcome).toBe("applied");
  }
  return last!.plan;
}

const req = (plan: CoordinationPlan, kind: "ride" | "invite") => currentActions(plan).find((a) => a.scope.kind === kind)!.providerRequestId!;
let evn = 0;
const ev = (requestId: string, type: ProviderEvent["type"], sequence = 1, extra: Partial<ProviderEvent> = {}): ProviderEvent => ({ eventId: `ev-${++evn}`, requestId, sequence, type, actor: "demo", ...extra });

// Golden path up to READY; returns the READY plan.
async function toReady(s: ReturnType<typeof setup>) {
  const created = ok(await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }));
  const id = created.plan.id;
  await s.c.command(id, { type: "accept_proposal" });
  const approved = await approveAll(s.c, (await s.c.get(id)).plan, s.at(HOUR));
  const exec = ok(await s.c.command(id, { type: "execute" }));
  expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
  await s.c.ingest(id, ev(req(exec.plan, "invite"), "invite.accepted"));
  const ready = ok(await s.c.ingest(id, ev(req(exec.plan, "ride"), "ride.confirmed")));
  return { id, approved, ready: ready.plan };
}

describe("planning", () => {
  it("proposes a ride and a companion invite for the golden workshop scenario", async () => {
    const { c } = setup();
    const r = ok(await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }));
    expect(r.plan.state).toBe("PROPOSED");
    const scopes = currentActions(r.plan).map((a) => [a.scope.kind, a.scope.recipientId]);
    expect(scopes).toEqual([["ride", "dan"], ["invite", "elaine"]]);
    expect(r.plan.dependencies.every((d) => d.status === "not_requested")).toBe(true);
    expect(r.plan.dataSource).toBe("mock");
  });

  it("never ignores a hard barrier: stairs + walker is BLOCKED and cannot be accepted", async () => {
    const { c } = setup();
    const r = ok(await c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS }));
    expect(r.plan.state).toBe("BLOCKED");
    expect(r.plan.blockers[0].rule).toBe("access");
    expect((await c.command(r.plan.id, { type: "accept_proposal" })).outcome).toBe("rejected");
    expect(r.plan.alternatives.map((a) => a.activityId)).toContain("circle");
  });

  it("a plan with no external dependencies becomes READY on acceptance without contacting anyone", async () => {
    const s = setup();
    const r = ok(await s.c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS }));
    const alt = ok(await s.c.command(r.plan.id, { type: "choose_alternative", activityId: "circle" }));
    expect(alt.plan.state).toBe("PROPOSED");
    expect((await s.c.command(r.plan.id, { type: "accept_proposal" })).plan.state).toBe("READY");
    expect((s.provider as ReturnType<typeof createMockProvider>).calls).toHaveLength(0);
  });

  it("rejects switching to an activity that was not offered", async () => {
    const { c } = setup();
    const r = await c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS });
    expect((await c.command(r.plan.id, { type: "choose_alternative", activityId: "loft" })).outcome).toBe("rejected"); // itself, never offered
    expect((await c.command(r.plan.id, { type: "choose_alternative", activityId: "made-up" })).outcome).toBe("rejected");
  });
});

describe("consent and dispatch", () => {
  it("golden path: nothing is sent before approval; READY only after every confirmation", async () => {
    const s = setup();
    const mock = s.provider as ReturnType<typeof createMockProvider>;
    const { id } = { id: (await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id };
    expect((await s.c.command(id, { type: "accept_proposal" })).plan.state).toBe("AWAITING_APPROVAL");

    const early = await s.c.command(id, { type: "execute" });
    expect(early.outcome).toBe("rejected");
    expect(mock.calls).toHaveLength(0);

    await approveAll(s.c, (await s.c.get(id)).plan, s.at(HOUR));
    const exec = ok(await s.c.command(id, { type: "execute" }));
    expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
    expect(mock.calls.map((x) => x.kind).sort()).toEqual(["invite", "ride"]);
    expect(exec.plan.dependencies.map((d) => d.status)).toEqual(["requested", "requested"]); // requested ≠ confirmed

    const half = await s.c.ingest(id, ev(req(exec.plan, "invite"), "invite.accepted"));
    expect(half.plan.state).toBe("PENDING_CONFIRMATION");
    expect(readyViolations(half.plan).length).toBeGreaterThan(0);

    const ready = await s.c.ingest(id, ev(req(exec.plan, "ride"), "ride.confirmed"));
    expect(ready.plan.state).toBe("READY");
    expect(readyViolations(ready.plan)).toEqual([]);
    expect(ready.events.map((e) => e.type)).toContain("plan.ready");
  });

  it("rejects approvals whose scope differs in recipient, kind, slot, or shared fields", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    const ride = currentActions(r.plan).find((a) => a.scope.kind === "ride")!;
    const bad: ActionScope[] = [
      { ...ride.scope, recipientId: "elaine" },
      { ...ride.scope, kind: "invite" },
      { ...ride.scope, when: "Sun afternoon" },
      { ...ride.scope, sharedFields: [...ride.scope.sharedFields, "homeAddress"] },
      { ...ride.scope, sharedFields: ride.scope.sharedFields.slice(1) },
    ];
    for (const scope of bad) {
      const res = await s.c.command(r.plan.id, { type: "approve", actionId: ride.id, scope, expiresAt: s.at(HOUR) });
      expect(res.outcome).toBe("rejected");
    }
    // Same fields in a different order is the same scope.
    const reordered = { ...ride.scope, sharedFields: [...ride.scope.sharedFields].reverse() };
    expect((await s.c.command(r.plan.id, { type: "approve", actionId: ride.id, scope: reordered, expiresAt: s.at(HOUR) })).outcome).toBe("applied");
  });

  it("rejects expired, over-long, and unknown-action approvals", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    const a = currentActions(r.plan)[0];
    expect((await s.c.command(r.plan.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(-1) })).outcome).toBe("rejected");
    expect((await s.c.command(r.plan.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: s.at(25 * HOUR) })).outcome).toBe("rejected");
    expect((await s.c.command(r.plan.id, { type: "approve", actionId: "forged", scope: a.scope, expiresAt: s.at(HOUR) })).outcome).toBe("rejected");
  });

  it("an approval that expires before execute blocks dispatch entirely (atomic) and must be renewed", async () => {
    const s = setup();
    const mock = s.provider as ReturnType<typeof createMockProvider>;
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    const [ride, invite] = currentActions(r.plan);
    await s.c.command(r.plan.id, { type: "approve", actionId: ride.id, scope: ride.scope, expiresAt: s.at(10 * 60_000) });
    await s.c.command(r.plan.id, { type: "approve", actionId: invite.id, scope: invite.scope, expiresAt: s.at(HOUR) });
    s.advance(11 * 60_000);
    const res = await s.c.command(r.plan.id, { type: "execute" });
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toMatch(/expired/);
    expect(mock.calls).toHaveLength(0); // the still-valid invite was not sent either
    expect(currentActions(res.plan).find((a) => a.id === ride.id)!.status).toBe("proposed");
  });

  it("revocation before dispatch prevents sending; after dispatch it is refused", async () => {
    const s = setup();
    const mock = s.provider as ReturnType<typeof createMockProvider>;
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    const plan = await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const invite = currentActions(plan).find((a) => a.scope.kind === "invite")!;
    expect((await s.c.command(plan.id, { type: "revoke", actionId: invite.id })).outcome).toBe("applied");
    expect((await s.c.command(plan.id, { type: "execute" })).outcome).toBe("rejected");
    expect(mock.calls).toHaveLength(0);

    await approveAll(s.c, (await s.c.get(plan.id)).plan, s.at(HOUR));
    await s.c.command(plan.id, { type: "execute" });
    expect((await s.c.command(plan.id, { type: "revoke", actionId: invite.id })).reason).toMatch(/Already sent/);
  });

  it("execute is idempotent: a retried execute never double-invites or double-books", async () => {
    const s = setup();
    const mock = s.provider as ReturnType<typeof createMockProvider>;
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    await Promise.all([s.c.command(r.plan.id, { type: "execute" }), s.c.command(r.plan.id, { type: "execute" })]);
    expect((await s.c.command(r.plan.id, { type: "execute" })).outcome).toBe("duplicate");
    expect(mock.calls).toHaveLength(2);
  });

  it("a provider network error keeps actions approved and a retry reuses the same idempotency key", async () => {
    let throwNext = true;
    const inner = createMockProvider();
    const flaky: ProviderPort = {
      dataSource: "mock",
      sendApprovedInvite: (i) => inner.sendApprovedInvite(i),
      requestApprovedRide: async (i) => {
        if (throwNext) {
          throwNext = false;
          await inner.requestApprovedRide(i); // the request did reach the provider before the timeout
          throw new Error("timeout");
        }
        return inner.requestApprovedRide(i);
      },
    };
    const s = setup({ provider: flaky });
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const first = await s.c.command(r.plan.id, { type: "execute" });
    expect(first.plan.state).toBe("AWAITING_APPROVAL");
    const retry = await s.c.command(r.plan.id, { type: "execute" });
    expect(retry.plan.state).toBe("PENDING_CONFIRMATION");
    expect(inner.calls.filter((x) => x.kind === "ride")).toHaveLength(1); // deduped by key, no double booking
  });
});

describe("provider evidence", () => {
  it("ignores duplicate events by eventId and by idempotencyKey", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    const e1 = ev(req(exec.plan, "ride"), "ride.confirmed", 1, { idempotencyKey: "cb-1" });
    expect((await s.c.ingest(r.plan.id, e1)).outcome).toBe("applied");
    expect((await s.c.ingest(r.plan.id, e1)).outcome).toBe("duplicate");
    const sameKey = await s.c.ingest(r.plan.id, { ...e1, eventId: "ev-other", type: "ride.cancelled", sequence: 2 });
    expect(sameKey.outcome).toBe("duplicate");
    expect(sameKey.plan.dependencies.find((d) => d.kind === "ride")!.status).toBe("confirmed");
  });

  it("an out-of-order stale confirmation cannot resurrect a cancelled ride", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    await s.c.ingest(r.plan.id, ev(req(exec.plan, "invite"), "invite.accepted"));
    const cancelled = await s.c.ingest(r.plan.id, ev(req(exec.plan, "ride"), "ride.cancelled", 2));
    expect(cancelled.plan.state).toBe("NEEDS_REPLAN");
    const late = await s.c.ingest(r.plan.id, ev(req(exec.plan, "ride"), "ride.confirmed", 1));
    expect(late.outcome).toBe("ignored");
    expect(late.plan.state).toBe("NEEDS_REPLAN");
  });

  it("rejects events for unknown requests or the wrong kind, and before anything was dispatched", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    expect((await s.c.ingest(r.plan.id, ev("mock-ride-forged", "ride.confirmed"))).outcome).toBe("rejected");
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    expect((await s.c.ingest(r.plan.id, ev(req(exec.plan, "invite"), "ride.confirmed"))).outcome).toBe("rejected");
    expect((await s.c.get(r.plan.id)).plan.state).toBe("PENDING_CONFIRMATION");
  });
});

describe("review regressions", () => {
  it("a ride decline while the invite is still in flight carries the live invite over instead of re-inviting", async () => {
    const s = setup();
    const mock = s.provider as ReturnType<typeof createMockProvider>;
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    const inviteReq = req(exec.plan, "invite");
    const replan = await s.c.ingest(r.plan.id, ev(req(exec.plan, "ride"), "ride.declined"));
    expect(replan.plan.state).toBe("NEEDS_REPLAN");
    expect(req(replan.plan, "invite")).toBe(inviteReq); // same live request, not superseded
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const again = await s.c.command(r.plan.id, { type: "execute" });
    expect(mock.calls.filter((x) => x.kind === "invite")).toHaveLength(1);
    await s.c.ingest(r.plan.id, ev(inviteReq, "invite.accepted")); // Elaine's reply to the original invite still counts
    const ready = await s.c.ingest(r.plan.id, ev(req(again.plan, "ride"), "ride.confirmed"));
    expect(ready.plan.state).toBe("READY");
  });

  it("choose_alternative keeps exclusions: someone who declined is not asked again", async () => {
    const SAME_DAY: Activity = { ...WORKSHOP, id: "fair", name: "Craft Fair" };
    let n = 0;
    const provider = createMockProvider();
    const c = createCoordinator({ provider, now: () => new Date(T0), activities: [...CATALOG, SAME_DAY], newId: () => `plan-${++n}` });
    const r = await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(c, (await c.get(r.plan.id)).plan, new Date(T0 + HOUR).toISOString());
    const exec = await c.command(r.plan.id, { type: "execute" });
    await c.ingest(r.plan.id, ev(req(exec.plan, "ride"), "ride.declined"));
    const alt = await c.command(r.plan.id, { type: "choose_alternative", activityId: "fair" });
    const ride = currentActions(alt.plan).find((a) => a.scope.kind === "ride")!;
    expect(ride.scope.recipientId).toBe(PARATRANSIT_ID);
    expect(ride.scope.activityId).toBe("fair");
    // The live invite for the workshop is superseded and listed for notification, not silently dropped.
    const sup = alt.events.find((e) => e.type === "actions.superseded")!;
    expect(sup.payload.dispatchedActionsToNotify).toEqual([currentActions(exec.plan).find((a) => a.scope.kind === "invite")!.id]);
  });

  it("scope comparison cannot be fooled by joining field names", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    const ride = currentActions(r.plan).find((a) => a.scope.kind === "ride")!;
    const forged = { ...ride.scope, sharedFields: ["mobility", "name|pickupWindow"] };
    expect((await s.c.command(r.plan.id, { type: "approve", actionId: ride.id, scope: forged, expiresAt: s.at(HOUR) })).outcome).toBe("rejected");
  });

  it("a provider mutating sharedFields cannot widen the privacy scope of later plans", async () => {
    const inner = createMockProvider();
    const greedy: ProviderPort = {
      dataSource: "mock",
      sendApprovedInvite: (i) => inner.sendApprovedInvite(i),
      requestApprovedRide: (i) => {
        i.sharedFields.push("homeAddress");
        return inner.requestApprovedRide(i);
      },
    };
    const s = setup({ provider: greedy });
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    await s.c.command(r.plan.id, { type: "execute" });
    expect(currentActions((await s.c.get(r.plan.id)).plan).find((a) => a.scope.kind === "ride")!.scope.sharedFields).not.toContain("homeAddress");
    const r2 = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    expect(currentActions(r2.plan).find((a) => a.scope.kind === "ride")!.scope.sharedFields).not.toContain("homeAddress");
  });

  it("a hung provider times out instead of holding the plan lock", async () => {
    vi.useFakeTimers();
    try {
      const hung: ProviderPort = { dataSource: "mock", sendApprovedInvite: () => new Promise(() => {}), requestApprovedRide: () => new Promise(() => {}) };
      const s = setup({ provider: hung });
      const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
      await s.c.command(r.plan.id, { type: "accept_proposal" });
      await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
      const pending = s.c.command(r.plan.id, { type: "execute" });
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS * 2 + 10);
      const res = await pending;
      expect(res.plan.state).toBe("AWAITING_APPROVAL");
      expect((await s.c.command(r.plan.id, { type: "cancel" })).plan.state).toBe("CANCELLED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("contract rejects duplicate or reserved contact ids", () => {
    const base = { profile: MAYA, activityId: "workshop" };
    expect(CreatePlanInput.safeParse({ ...base, contacts: [CONTACTS[0], CONTACTS[0]] }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ ...base, contacts: [{ id: "paratransit", name: "X" }] }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ ...base, contacts: CONTACTS }).success).toBe(true);
  });
});

describe("disruption and recovery", () => {
  it("ride cancellation revokes READY, keeps the confirmed invite, and requires new approval for the new ride", async () => {
    const s = setup();
    const mock = s.provider as ReturnType<typeof createMockProvider>;
    const { id, ready } = await toReady(s);
    const oldRide = req(ready, "ride");
    const inviteId = currentActions(ready).find((a) => a.scope.kind === "invite")!.id;

    const cancelled = ok(await s.c.ingest(id, ev(oldRide, "ride.cancelled", 2)));
    expect(cancelled.plan.state).toBe("NEEDS_REPLAN");
    expect(cancelled.events.map((e) => e.type)).toEqual(expect.arrayContaining(["plan.ready_revoked", "plan.replan_required"]));
    const newRide = currentActions(cancelled.plan).find((a) => a.scope.kind === "ride")!;
    expect(newRide.scope.recipientId).toBe(PARATRANSIT_ID); // Dan cancelled → next option
    expect(newRide.status).toBe("proposed");
    expect(currentActions(cancelled.plan).find((a) => a.scope.kind === "invite")!.id).toBe(inviteId); // carried over

    expect((await s.c.command(id, { type: "accept_proposal" })).plan.state).toBe("AWAITING_APPROVAL");
    expect((await s.c.command(id, { type: "execute" })).outcome).toBe("rejected"); // old approval doesn't cover new scope
    await approveAll(s.c, (await s.c.get(id)).plan, s.at(HOUR));
    const exec = await s.c.command(id, { type: "execute" });
    expect(exec.plan.state).toBe("PENDING_CONFIRMATION");
    const again = await s.c.ingest(id, ev(req(exec.plan, "ride"), "ride.confirmed"));
    expect(again.plan.state).toBe("READY");
    expect(mock.calls.filter((x) => x.kind === "invite")).toHaveLength(1); // Elaine was not re-invited
    // Late events for the superseded ride are ignored.
    expect((await s.c.ingest(id, ev(oldRide, "ride.confirmed", 3))).outcome).toBe("ignored");
    expect((await s.c.get(id)).plan.state).toBe("READY");
  });

  it("companion decline triggers a replan without the declined companion", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: [...CONTACTS, { id: "rosa", name: "Rosa", canDrive: false }] });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    const declined = await s.c.ingest(r.plan.id, ev(req(exec.plan, "invite"), "invite.declined"));
    expect(declined.plan.state).toBe("NEEDS_REPLAN");
    const invite = currentActions(declined.plan).find((a) => a.scope.kind === "invite")!;
    expect(invite.scope.recipientId).not.toBe("elaine");
  });

  it("provider failure at dispatch goes straight to NEEDS_REPLAN with a recovery option", async () => {
    const s = setup({ provider: createMockProvider({ fail: (i) => i.recipientId === "dan" }) });
    const r = await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    expect(exec.plan.state).toBe("NEEDS_REPLAN");
    expect(currentActions(exec.plan).find((a) => a.scope.kind === "ride")!.scope.recipientId).toBe(PARATRANSIT_ID);
  });

  it("when no recovery exists, the plan stays NEEDS_REPLAN with blockers and offers alternatives", async () => {
    const s = setup({ profile: MAYA });
    const r = await s.c.create({ profile: { ...MAYA, transport: ["bus", "family"] }, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    const res = await s.c.ingest(r.plan.id, ev(req(exec.plan, "ride"), "ride.declined"));
    expect(res.plan.state).toBe("NEEDS_REPLAN");
    expect(res.plan.blockers[0].rule).toBe("transport");
    expect((await s.c.command(r.plan.id, { type: "accept_proposal" })).outcome).toBe("rejected");
    expect(res.plan.alternatives.map((a) => a.activityId)).toContain("circle");
  });
});

describe("completion and feedback", () => {
  it("feedback proposes a patch; preferences change only after explicit confirmation, and ranking shifts", async () => {
    const s = setup();
    const p0: Profile = { ...MAYA, prefersSmallGroups: false };
    const r = await s.c.create({ profile: p0, activityId: "workshop", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await approveAll(s.c, (await s.c.get(r.plan.id)).plan, s.at(HOUR));
    const exec = await s.c.command(r.plan.id, { type: "execute" });
    expect((await s.c.command(r.plan.id, { type: "feedback", signals: ["too_crowded"] })).outcome).toBe("rejected"); // not completed yet
    await s.c.ingest(r.plan.id, ev(req(exec.plan, "ride"), "ride.confirmed"));
    expect((await s.c.command(r.plan.id, { type: "complete", attended: true })).plan.outcome).toEqual({ attended: true, source: "self_reported" });

    const fb = ok(await s.c.command(r.plan.id, { type: "feedback", signals: ["too_crowded", "enjoyed"] }));
    expect(fb.plan.preferencePatches).toHaveLength(1);
    expect(fb.plan.profile.prefersSmallGroups).toBe(false); // proposal only
    expect(fb.plan.profileVersion).toBe(1);

    const before = softCount(fb.plan.profile, WORKSHOP);
    const patchId = fb.plan.preferencePatches[0].id;
    const applied = ok(await s.c.command(r.plan.id, { type: "confirm_preference", patchId }));
    expect(applied.plan.profile.prefersSmallGroups).toBe(true);
    expect(applied.plan.profileVersion).toBe(2);
    expect(softCount(applied.plan.profile, WORKSHOP)).toBe(before + 1); // large-group workshop now ranks lower
    expect(softCount(applied.plan.profile, CIRCLE)).toBe(softCount(fb.plan.profile, CIRCLE)); // small group unaffected
    expect((await s.c.command(r.plan.id, { type: "confirm_preference", patchId })).outcome).toBe("duplicate");
  });

  it("rejected patches never change the profile", async () => {
    const s = setup();
    const r = await s.c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS });
    await s.c.command(r.plan.id, { type: "choose_alternative", activityId: "circle" });
    await s.c.command(r.plan.id, { type: "accept_proposal" });
    await s.c.command(r.plan.id, { type: "complete", attended: true });
    const fb = await s.c.command(r.plan.id, { type: "feedback", signals: ["too_far"] });
    const patch = fb.plan.preferencePatches[0];
    expect(patch).toMatchObject({ field: "maxTravelMin", from: 30, to: 20 });
    const res = await s.c.command(r.plan.id, { type: "reject_preference", patchId: patch.id });
    expect(res.plan.profile.maxTravelMin).toBe(30);
    expect(res.plan.preferencePatches[0].status).toBe("rejected");
  });

  it("closed plans ignore provider events and reject further commands", async () => {
    const s = setup();
    const { id, ready } = await toReady(s);
    await s.c.command(id, { type: "cancel" });
    expect((await s.c.ingest(id, ev(req(ready, "ride"), "ride.cancelled", 5))).outcome).toBe("ignored");
    expect((await s.c.command(id, { type: "execute" })).outcome).toBe("rejected");
    expect((await s.c.get(id)).plan.state).toBe("CANCELLED");
  });

  it("throws a 404-style error for unknown plans", async () => {
    const { c } = setup();
    await expect(c.command("nope", { type: "cancel" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("invariant fuzz", () => {
  // Seeded random walk over commands and provider events (including forged, duplicate, stale and
  // out-of-order ones). After every step: READY ⇒ invariant holds, and no dispatch without a valid approval.
  it("never reaches READY without approvals and confirmations across 300 random walks", async () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    let readyHits = 0;
    let replanHits = 0;
    for (let walk = 0; walk < 300; walk++) {
      const s = setup({ provider: createMockProvider({ fail: () => rnd() < 0.1 }) });
      const mock = s.provider as ReturnType<typeof createMockProvider>;
      const { plan } = await s.c.create({ profile: MAYA, activityId: pick(["workshop", "loft"]), contacts: CONTACTS });
      const seqs = new Map<string, number>();
      for (let step = 0; step < 25; step++) {
        const cur = (await s.c.get(plan.id)).plan;
        const acts = currentActions(cur);
        const a = acts.length ? pick(acts) : undefined;
        const choice = Math.floor(rnd() * 9);
        if (choice === 0) await s.c.command(plan.id, { type: "accept_proposal" });
        else if (choice === 1 && a) await s.c.command(plan.id, { type: "approve", actionId: a.id, scope: rnd() < 0.8 ? a.scope : { ...a.scope, recipientId: "mallory" }, expiresAt: s.at(rnd() < 0.8 ? HOUR : -1) });
        else if (choice === 2) await s.c.command(plan.id, { type: "execute" });
        else if (choice === 3 && a) await s.c.command(plan.id, { type: "revoke", actionId: a.id });
        else if (choice === 4) s.advance(Math.floor(rnd() * 2 * HOUR));
        else if (choice === 5 && cur.alternatives.length) await s.c.command(plan.id, { type: "choose_alternative", activityId: pick(cur.alternatives).activityId });
        else if (choice >= 6) {
          const any = pick(cur.actions.filter((x) => x.providerRequestId).concat(a ? [a] : []));
          if (!any) continue;
          const rid = any.providerRequestId ?? "forged";
          const n = rnd() < 0.2 ? Math.max(1, (seqs.get(rid) ?? 1) - 1) : (seqs.get(rid) ?? 0) + 1; // sometimes stale
          seqs.set(rid, Math.max(n, seqs.get(rid) ?? 0));
          const kind = rnd() < 0.9 ? any.scope.kind : any.scope.kind === "ride" ? "invite" : "ride";
          const type = pick(kind === "ride" ? (["ride.confirmed", "ride.confirmed", "ride.cancelled", "ride.declined"] as const) : (["invite.accepted", "invite.accepted", "invite.declined"] as const));
          await s.c.ingest(plan.id, ev(rid, type, n));
        }
        const now = (await s.c.get(plan.id)).plan;
        CoordinationPlan.parse(now);
        if (now.state === "READY") {
          readyHits++;
          expect(readyViolations(now)).toEqual([]);
        }
        if (now.state === "NEEDS_REPLAN") replanHits++;
        for (const call of mock.calls) {
          const appr = now.approvals.find((x) => x.id === call.approvalId);
          expect(appr, `dispatch without approval in walk ${walk}`).toBeDefined();
          expect(appr!.scope.recipientId).toBe(call.recipientId);
        }
      }
    }
    // Guard against a vacuous fuzz: the walk must actually exercise READY and recovery.
    expect(readyHits).toBeGreaterThan(0);
    expect(replanHits).toBeGreaterThan(0);
  }, 30_000); // ~2-6 s depending on machine load
});
