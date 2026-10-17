import { describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activities";
import type { CoordinationPlan, Contact, Profile, ProviderEvent } from "@/lib/schema";
import { createCoordinator, currentActions } from "./coordinator";
import { describePlan } from "./narrative";
import { createMockProvider } from "./provider";

// Synthetic fixtures (fictional), independent of the human-owned activity catalog.
const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const LOFT: Activity = { id: "loft", name: "Upstairs Pottery Loft", tags: ["crafts"], day: "Tue", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: false, groupSize: "small", noisy: false, hearingLoop: false };
const CIRCLE: Activity = { id: "circle", name: "Library Knitting Circle", tags: ["crafts"], day: "Wed", time: "afternoon", costPerWeek: 0, travelMin: { bus: 10 }, stepFree: true, groupSize: "small", noisy: false, hearingLoop: false };
const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];
const T0 = Date.parse("2026-10-17T12:00:00Z");
const inHour = new Date(T0 + 3600_000).toISOString();
let evn = 0;
const ev = (requestId: string, type: ProviderEvent["type"], sequence = 1): ProviderEvent => ({ eventId: `n-${++evn}`, requestId, sequence, type, actor: "demo" });
const req = (p: CoordinationPlan, kind: "ride" | "invite") => currentActions(p).find((a) => a.scope.kind === kind)!.providerRequestId!;
const text = (p: CoordinationPlan) => JSON.stringify(describePlan(p));
const FORBIDDEN_FOR_REQUESTED = /confirmed|booked|all set/i;

function setup() {
  let n = 0;
  const c = createCoordinator({ provider: createMockProvider(), now: () => new Date(T0), activities: [WORKSHOP, LOFT, CIRCLE], newId: () => `plan-${++n}` });
  const approveAll = async (id: string) => {
    for (const a of currentActions((await c.get(id)).plan).filter((x) => x.status === "proposed" || x.status === "revoked"))
      await c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: inHour });
    return (await c.get(id)).plan;
  };
  return { c, approveAll };
}

async function pending() {
  const s = setup();
  const id = (await s.c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
  await s.c.command(id, { type: "accept_proposal" });
  await s.approveAll(id);
  const plan = (await s.c.command(id, { type: "execute" })).plan;
  return { ...s, id, plan };
}

async function ready() {
  const s = await pending();
  await s.c.ingest(s.id, ev(req(s.plan, "invite"), "invite.accepted"));
  const plan = (await s.c.ingest(s.id, ev(req(s.plan, "ride"), "ride.confirmed"))).plan;
  return { ...s, plan };
}

async function replan() {
  const s = await ready();
  const plan = (await s.c.ingest(s.id, ev(req(s.plan, "ride"), "ride.cancelled", 2))).plan;
  return { ...s, plan };
}

describe("describePlan", () => {
  it("BLOCKED lists blockers and alternatives", async () => {
    const { c } = setup();
    const n = describePlan((await c.create({ profile: MAYA, activityId: "loft", contacts: CONTACTS })).plan);
    expect(n.status).toBe("blocked");
    expect(n.headline).toBe("Maya can't go to Upstairs Pottery Loft (Tue afternoon) yet");
    expect(n.lines.some((l) => l.startsWith("✗ "))).toBe(true);
    expect(n.nextStep).toContain("Try instead: Library Knitting Circle (Wed afternoon)");
  });

  it("PROPOSED names each request with contact names", async () => {
    const { c } = setup();
    const n = describePlan((await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan);
    expect(n.status).toBe("needs_you");
    expect(n.headline).toBe("Here's how Maya can get to Saturday Craft Workshop (Sat afternoon)");
    expect(n.lines).toEqual(expect.arrayContaining(["• Ride from Dan (needs your OK)", "• Invite to Elaine (needs your OK)"]));
  });

  it("AWAITING_APPROVAL says which actions need approval and what is shared", async () => {
    const { c } = setup();
    const id = (await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS })).plan.id;
    let p = (await c.command(id, { type: "accept_proposal" })).plan;
    let n = describePlan(p);
    expect(n.status).toBe("needs_you");
    expect(n.nextStep).toBe("Approve Ride from Dan (shares name, pickup window and mobility) and Invite to Elaine (shares name, activity name and time), then send the requests");
    const ride = currentActions(p).find((a) => a.scope.kind === "ride")!;
    p = (await c.command(id, { type: "approve", actionId: ride.id, scope: ride.scope, expiresAt: inHour })).plan;
    n = describePlan(p);
    expect(n.lines).toContain("• Ride from Dan approved, not sent yet");
    expect(n.nextStep).toBe("Approve Invite to Elaine (shares name, activity name and time), then send the requests");
    expect(text(p)).not.toMatch(FORBIDDEN_FOR_REQUESTED);
  });

  it("PENDING_CONFIRMATION: requested is never described as confirmed, booked or all set", async () => {
    const s = await pending();
    let n = describePlan(s.plan);
    expect(n.status).toBe("waiting");
    expect(n.lines).toEqual(["⏳ Ride from Dan sent, waiting for a reply", "⏳ Invite to Elaine sent, waiting for a reply"]);
    expect(text(s.plan)).not.toMatch(FORBIDDEN_FOR_REQUESTED);
    // One reply in, the other still requested: still no confirmed/booked/all-set wording.
    const half = (await s.c.ingest(s.id, ev(req(s.plan, "invite"), "invite.accepted"))).plan;
    n = describePlan(half);
    expect(half.state).toBe("PENDING_CONFIRMATION");
    expect(n.lines).toContain("✓ Invite to Elaine accepted");
    expect(text(half)).not.toMatch(FORBIDDEN_FOR_REQUESTED);
    expect(n.nextStep).toBe("Nothing to do yet — waiting on Ride from Dan");
  });

  it("READY says all set and lists confirmations", async () => {
    const { plan } = await ready();
    const n = describePlan(plan);
    expect(n.status).toBe("ready");
    expect(n.headline).toBe("Maya is all set for Saturday Craft Workshop (Sat afternoon)");
    expect(n.lines).toEqual(["✓ Ride from Dan confirmed", "✓ Invite to Elaine accepted"]);
  });

  it("NEEDS_REPLAN explains what changed and the new option", async () => {
    const { plan } = await replan();
    const n = describePlan(plan);
    expect(n.status).toBe("replanning");
    expect(n.lines).toContain("✗ Ride from Dan cancelled — new option: Paratransit ride (needs your OK)");
    expect(n.lines).toContain("✓ Invite to Elaine accepted");
    expect(n.nextStep).toBe("Accept the new plan, then approve Paratransit ride (shares name, pickup window and mobility)");
  });

  it("COMPLETED mentions preference patches awaiting confirmation", async () => {
    const s = await ready();
    await s.c.command(s.id, { type: "complete", attended: true });
    let p = (await s.c.command(s.id, { type: "feedback", signals: ["too_far"] })).plan;
    let n = describePlan(p);
    expect(n.status).toBe("done");
    expect(n.headline).toBe("Maya went to Saturday Craft Workshop (Sat afternoon)");
    expect(n.lines).toContain("? Suggested change: keep trips under 20 min (was 30 min) — waiting for your confirmation");
    expect(n.nextStep).toBe("Confirm or reject 1 suggested preference change");
    p = (await s.c.command(s.id, { type: "confirm_preference", patchId: p.preferencePatches[0].id })).plan;
    n = describePlan(p);
    expect(n.nextStep).toBeNull();
    expect(n.lines.some((l) => l.startsWith("?"))).toBe(false);
  });

  it("CANCELLED says who should be told, mapping paratransit to a readable name", async () => {
    const s = await replan();
    await s.c.command(s.id, { type: "accept_proposal" });
    await s.approveAll(s.id);
    await s.c.command(s.id, { type: "execute" });
    const p = (await s.c.command(s.id, { type: "cancel" })).plan;
    const n = describePlan(p);
    expect(n.status).toBe("cancelled");
    expect(n.headline).toBe("Maya's plan for Saturday Craft Workshop (Sat afternoon) was cancelled");
    expect(n.nextStep).toBe("Let Elaine and Paratransit service know it's off");
  });
});

describe("cancel revokes stale approvals (F3)", () => {
  it("approved-but-unsent actions are revoked; dispatched ones are listed to notify", async () => {
    const s = await replan();
    await s.c.command(s.id, { type: "accept_proposal" });
    const approved = await s.approveAll(s.id);
    const para = currentActions(approved).find((a) => a.scope.recipientId === "paratransit")!;
    expect(para.status).toBe("approved");
    const r = await s.c.command(s.id, { type: "cancel" });
    const after = r.plan.actions.find((a) => a.id === para.id)!;
    expect(after.status).toBe("revoked");
    expect(after.approvalId).toBeUndefined();
    expect(r.plan.approvals.filter((x) => x.actionId === para.id).every((x) => x.revoked)).toBe(true);
    expect(r.plan.actions.some((a) => a.status === "approved")).toBe(false);
    const invite = currentActions(r.plan).find((a) => a.scope.kind === "invite")!;
    expect(invite.status).toBe("dispatched");
    expect(r.events[0].payload).toMatchObject({ dispatchedActionsToNotify: [invite.id], revokedActionIds: [para.id] });
    expect(describePlan(r.plan).nextStep).toBe("Let Elaine know it's off");
  });
});
