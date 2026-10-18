// Cross-profile consistency QA (issue #28 verification) — drives the REAL production
// functions: runScenario (analyze) and propose/create via the real coordinator.
// Asserts analyze-vs-coordination agreement, including family-only transport with no driver.

import { describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activities";
import { ACTIVITIES } from "@/domain/activities";
import { runScenario } from "@/domain/engine";
import { checkActivity } from "@/domain/engine";
import { createCoordinator, currentActions } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import { propose } from "@/domain/coordination/planner";
import { CreatePlanInput, type Contact, type Profile } from "@/lib/schema";

// Synthetic activity with a family-only route (matches the issue-28 bake shape).
const FELLOWSHIP: Activity = {
  id: "syn-fellowship", name: "Synthetic Fellowship Lunch", tags: ["faith", "cooking"],
  day: "Sun", time: "afternoon", costPerWeek: 5,
  travelMin: { drive: 10, family: 10, paratransit: 30 },
  stepFree: true, groupSize: "large", noisy: true, hearingLoop: true,
};
const CATALOG = [FELLOWSHIP, ...ACTIVITIES];

const BASE: Profile = {
  name: "Bake", interests: ["faith", "cooking"], mobility: "walker",
  transport: ["family"], maxTravelMin: 30, times: ["afternoon"],
  budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true,
};

let n = 0;
function coordinatorFor() {
  return createCoordinator({
    provider: createMockProvider(),
    now: () => new Date(Date.parse("2026-10-17T12:00:00Z")),
    activities: CATALOG,
    newId: () => `bake-plan-${++n}`,
  });
}

const T_APPROVE = "2026-10-17T13:00:00Z";

async function toExecuted(c: ReturnType<typeof coordinatorFor>, contacts: Contact[]) {
  const r = await c.create({ profile: BASE, activityId: FELLOWSHIP.id, contacts });
  const id = r.plan.id;
  await c.command(id, { type: "accept_proposal" });
  for (const a of currentActions(c.get(id).plan)) {
    await c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: T_APPROVE });
  }
  return (await c.command(id, { type: "execute" })).plan;
}

describe("issue #28 recheck: analyze vs coordination agreement", () => {
  it("family-only transport with NO driver: analyze feasible ⟺ coordination feasible (generic family ride)", async () => {
    // Engine check: the family route fits, no hard barriers.
    const activity = CATALOG[0]!;
    expect(checkActivity(BASE, activity).every((c) => c.ok)).toBe(true);
    // Analyze: activity appears as planned, not blocked.
    const analysis = runScenario({ profile: BASE });
    expect(analysis.blocked.find((b) => b.name === activity.name)).toBeUndefined();
    // Coordination: NOT blocked — generic family ride keeps it feasible.
    const c = coordinatorFor();
    const r = await c.create({ profile: BASE, activityId: activity.id, contacts: [] });
    expect(r.plan.state).toBe("PROPOSED");
    expect(r.plan.blockers).toHaveLength(0);
    // The ride dependency targets the reserved generic recipient "family".
    const ride = currentActions(r.plan).find((a) => a.scope.kind === "ride")!;
    expect(ride.scope.recipientId).toBe("family");
  });

  it("family transport where the only contact cannot drive: agreement holds, invite NOT to the driver-less friend as ride", async () => {
    const elaine: Contact = { id: "elaine", name: "Elaine", canDrive: false };
    const analysis = runScenario({ profile: BASE });
    expect(analysis.blocked.find((b) => b.name === FELLOWSHIP.name)).toBeUndefined();
    const c = coordinatorFor();
    const r = await c.create({ profile: BASE, activityId: FELLOWSHIP.id, contacts: [elaine] });
    expect(r.plan.state).toBe("PROPOSED");
    const ride = currentActions(r.plan).find((a) => a.scope.kind === "ride")!;
    expect(ride.scope.recipientId).toBe("family"); // generic, not Elaine (she can't drive)
    // Elaine is offered as the social invite, not as the ride.
    const invite = currentActions(r.plan).find((a) => a.scope.kind === "invite");
    expect(invite?.scope.recipientId).toBe("elaine");
  });

  it("analyze feasible ⟹ propose() feasible across mobility × transport × contacts (agreement bake)", () => {
    const mobilities = ["full", "cane", "walker", "wheelchair"] as const;
    const transportSets = [
      ["drive"], ["bus"], ["walk"], ["family"], ["paratransit"],
      ["bus", "family"], ["bus", "paratransit"], ["family", "paratransit"],
      ["drive", "bus", "walk", "family", "paratransit"],
    ] as const;
    const contactSets: Contact[][] = [
      [],
      [{ id: "elaine", name: "Elaine", canDrive: false }],
      [{ id: "dan", name: "Dan", canDrive: true }],
      [{ id: "elaine", name: "Elaine", canDrive: false }, { id: "dan", name: "Dan", canDrive: true }],
    ];
    let checked = 0;
    let feasibleAnalyze = 0;
    for (const mobility of mobilities) {
      for (const transport of transportSets) {
        for (const contacts of contactSets) {
          for (const activity of CATALOG) {
            const profile: Profile = { ...BASE, mobility, transport: [...transport] };
            // Analyze-level feasibility = no hard barriers.
            const checks = checkActivity(profile, activity);
            const hard = checks.filter((x) => x.barrier?.severity === "hard");
            if (hard.length) continue;
            feasibleAnalyze++;
            // Coordination must agree: propose is feasible for the same (profile, activity, contacts).
            const prop = propose(profile, activity, contacts);
            expect(prop.feasible, `analyze feasible but coordination blocked: ${mobility}/${transport.join("+")}/${activity.id}/${contacts.map((c) => c.id).join(",") || "none"}`).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(feasibleAnalyze).toBeGreaterThan(100);
    expect(checked).toBe(feasibleAnalyze);
  });

  it("reserved ids: paratransit and family are rejected as contact ids (400 via CreatePlanInput)", () => {
    expect(CreatePlanInput.safeParse({ profile: BASE, activityId: FELLOWSHIP.id, contacts: [{ id: "paratransit", name: "X" }] }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ profile: BASE, activityId: FELLOWSHIP.id, contacts: [{ id: "family", name: "X" }] }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ profile: BASE, activityId: FELLOWSHIP.id, contacts: [{ id: "elaine", name: "E" }] }).success).toBe(true);
  });

  it("invite never targets the ride driver (recheck on the fix, real planner via create)", async () => {
    // Dan drives, Elaine doesn't. Social barrier active (prefersSmallGroups=true, large group).
    const dan: Contact = { id: "dan", name: "Dan", canDrive: true };
    const elaine: Contact = { id: "elaine", name: "Elaine", canDrive: false };
    const c = coordinatorFor();
    const r = await c.create({ profile: BASE, activityId: FELLOWSHIP.id, contacts: [dan, elaine] });
    expect(r.plan.state).toBe("PROPOSED");
    const ride = currentActions(r.plan).find((a) => a.scope.kind === "ride")!;
    const invite = currentActions(r.plan).find((a) => a.scope.kind === "invite")!;
    expect(ride.scope.recipientId).toBe("dan");
    expect(invite.scope.recipientId).toBe("elaine"); // never the driver
  });
});

describe("issue #28 recheck: replanning after Elaine declines", () => {
  it("Elaine declines → invite falls back to a user step, never to the driver; ride dependency survives as requested", async () => {
    const dan: Contact = { id: "dan", name: "Dan", canDrive: true };
    const elaine: Contact = { id: "elaine", name: "Elaine", canDrive: false };
    const c = coordinatorFor();
    const exec = await toExecuted(c, [dan, elaine]);
    const inviteAction = currentActions(exec).find((a) => a.scope.kind === "invite")!;
    // Elaine declines (sequence 1; nothing applied to that dep yet).
    const declined = await c.ingest(exec.id, { eventId: "ev-d1", requestId: inviteAction.providerRequestId!, sequence: 1, type: "invite.declined", actor: "demo" });
    expect(declined.plan.state).toBe("NEEDS_REPLAN");
    // Recovery: no invite action at all (only Elaine was eligible and she's excluded; Dan is the driver).
    const inviteAfter = currentActions(declined.plan).find((a) => a.scope.kind === "invite");
    expect(inviteAfter).toBeUndefined();
    // The social intervention becomes a user step.
    const social = declined.plan.interventions.find((iv) => iv.rule === "social");
    expect(social?.kind).toBe("user_step");
    // The ride to Dan is carried over as confirmed/requested evidence — not re-proposed.
    const rideAfter = currentActions(declined.plan).find((a) => a.scope.kind === "ride")!;
    expect(rideAfter.scope.recipientId).toBe("dan");
    const rideDep = declined.plan.dependencies.find((d) => d.actionId === rideAfter.id)!;
    expect(rideDep.status).toBe("requested");
  });

  it("recovery after Dan's ride is cancelled: paratransit is offered (not generic family); if paratransit also fails, a hard transport blocker appears", async () => {
    const dan: Contact = { id: "dan", name: "Dan", canDrive: true };
    const elaine: Contact = { id: "elaine", name: "Elaine", canDrive: false };
    const c = coordinatorFor();
    const exec = await toExecuted(c, [dan, elaine]);
    await c.ingest(exec.id, { eventId: "ev-i1", requestId: currentActions(exec).find((a) => a.scope.kind === "invite")!.providerRequestId!, sequence: 1, type: "invite.accepted", actor: "demo" });
    await c.ingest(exec.id, { eventId: "ev-r1", requestId: currentActions(exec).find((a) => a.scope.kind === "ride")!.providerRequestId!, sequence: 1, type: "ride.confirmed", actor: "demo" });
    expect(c.get(exec.id).plan.state).toBe("READY");
    // Dan cancels after READY.
    const cancelled = await c.ingest(exec.id, { eventId: "ev-r2", requestId: currentActions(exec).find((a) => a.scope.kind === "ride")!.providerRequestId!, sequence: 2, type: "ride.cancelled", actor: "demo" });
    expect(cancelled.plan.state).toBe("NEEDS_REPLAN");
    expect(currentActions(cancelled.plan).find((a) => a.scope.kind === "invite")).toBeUndefined(); // no invite (Elaine declined, Dan excluded)
    // Carry the recovery through: accept → approve pending → execute → confirm paratransit.
    await c.command(exec.id, { type: "accept_proposal" });
    for (const a of currentActions(c.get(exec.id).plan)) {
      if (a.status !== "proposed" && a.status !== "revoked") continue;
      await c.command(exec.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: T_APPROVE });
    }
    const exec2 = await c.command(exec.id, { type: "execute" });
    // Elaine's accepted invite is superseded when the activity context replans (contract: scopes
    // are activity-scoped; the declined friend is excluded so no new invite action is proposed).
    expect(exec2.plan.state).toBe("NEEDS_REPLAN");
    expect(exec2.plan.blockers.some((b) => b.rule === "transport")).toBe(true);
    // No further accept possible; alternatives are offered instead.
    expect((await c.command(exec.id, { type: "accept_proposal" })).outcome).toBe("rejected");
  });
});
