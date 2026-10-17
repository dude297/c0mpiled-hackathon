import { describe, expect, it } from "vitest";
import { ACTIVITIES, type Activity } from "@/domain/activities";
import { checkActivity } from "@/domain/engine";
import { CreatePlanInput, type CoordinationPlan, type Contact, type Profile } from "@/lib/schema";
import { createCoordinator, currentActions } from "./coordinator";
import { FAMILY_ID, PARATRANSIT_ID, propose } from "./planner";
import { createMockProvider } from "./provider";

const MAYA: Profile = { name: "Maya", interests: ["faith"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const ELAINE: Contact = { id: "elaine", name: "Elaine", relation: "friend", canDrive: false };
const DAN: Contact = { id: "dan", name: "Dan", relation: "son", canDrive: true };
const fellowship = ACTIVITIES.find((a) => a.id === "fellowship")!;

function setup() {
  let n = 0;
  const c = createCoordinator({ provider: createMockProvider(), now: () => new Date("2026-10-17T12:00:00Z"), newId: () => `plan-${++n}` });
  return c;
}

async function execute(c: ReturnType<typeof setup>, profile: Profile, contacts: Contact[]) {
  const r = await c.create({ profile, activityId: "fellowship", contacts });
  const id = r.plan.id;
  await c.command(id, { type: "accept_proposal" });
  for (const a of currentActions(c.get(id).plan)) await c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: "2026-10-17T13:00:00Z" });
  return (await c.command(id, { type: "execute" })).plan;
}
const reqOf = (p: CoordinationPlan, kind: "ride" | "invite") => currentActions(p).find((a) => a.scope.kind === kind)!.providerRequestId!;

describe("#28: the friend invite never targets the driver", () => {
  it("Maya: Elaine declines → replan has no invite to Dan, shows the 'Bring a friend' user step", async () => {
    const c = setup();
    const exec = await execute(c, MAYA, [ELAINE, DAN]);
    expect(currentActions(exec).map((a) => [a.scope.kind, a.scope.recipientId])).toEqual([["ride", "dan"], ["invite", "elaine"]]);
    const res = await c.ingest(exec.id, { eventId: "e1", requestId: reqOf(exec, "invite"), sequence: 1, type: "invite.declined", actor: "demo" });
    expect(res.plan.state).toBe("NEEDS_REPLAN");
    expect(currentActions(res.plan).filter((a) => a.scope.kind === "invite")).toEqual([]);
    expect(res.plan.interventions.find((i) => i.rule === "social")).toMatchObject({ kind: "user_step", description: "Bring a friend for the first visit" });
  });

  it("a driver-only contact list never gets invited as the friend", () => {
    const prop = propose(MAYA, fellowship, [DAN]);
    expect(prop.feasible && prop.actions.map((a) => a.scope.recipientId)).toEqual(["dan"]);
  });
});

describe("#28: coordination agrees with analyze (generic family ride)", () => {
  it("no driving contact + family route → ride action to FAMILY_ID that still needs a confirmation event", async () => {
    const c = setup();
    const profile: Profile = { ...MAYA, transport: ["family"], prefersSmallGroups: false };
    const exec = await execute(c, profile, []);
    const ride = currentActions(exec).find((a) => a.scope.kind === "ride")!;
    expect(ride.scope.recipientId).toBe(FAMILY_ID);
    expect(ride.description).toBe("Ride from family (you'll arrange it)");
    expect(exec.state).toBe("PENDING_CONFIRMATION");
    const res = await c.ingest(exec.id, { eventId: "e1", requestId: ride.providerRequestId!, sequence: 1, type: "ride.confirmed", actor: "demo" });
    expect(res.plan.state).toBe("READY");
  });

  it("generic family is skipped once a specific driver failed (Dan cancels → paratransit, not 'family')", () => {
    const prop = propose(MAYA, fellowship, [ELAINE, DAN], { recipients: new Set(["dan"]) });
    expect(prop.feasible && prop.actions.find((a) => a.scope.kind === "ride")!.scope.recipientId).toBe(PARATRANSIT_ID);
  });

  it('"family" is a reserved contact id', () => {
    expect(CreatePlanInput.safeParse({ profile: MAYA, activityId: "fellowship", contacts: [{ id: "family", name: "X" }] }).success).toBe(false);
  });

  it("bake: every activity without a hard barrier in checkActivity is feasible in propose()", () => {
    const mobilities = ["full", "cane", "walker", "wheelchair"] as const;
    const modes = ["drive", "bus", "paratransit", "family", "walk"] as const;
    const transports = Array.from({ length: 31 }, (_, m) => modes.filter((_, i) => ((m + 1) & (1 << i)) !== 0));
    const timesets: Profile["times"][] = [["morning"], ["afternoon"], ["morning", "afternoon", "evening"]];
    const contactSets: Contact[][] = [[], [ELAINE], [DAN]];
    const synthetic: Activity[] = [];
    let k = 0;
    for (const travel of [{ family: 10 }, { family: 40 }, { paratransit: 20 }, { family: 15, paratransit: 25 }, { bus: 50, family: 15 }, { walk: 10, family: 5 }, { drive: 10 }])
      for (const time of ["morning", "afternoon"] as const)
        for (const groupSize of ["small", "large"] as const)
          for (const stepFree of [true, false])
            synthetic.push({ id: `syn-${k++}`, name: "Syn", tags: ["crafts"], day: "Mon", time, costPerWeek: 5, travelMin: travel, stepFree, groupSize, noisy: true, hearingLoop: false });

    let checked = 0;
    const failures: string[] = [];
    for (const mobility of mobilities)
      for (const transport of transports)
        for (const times of timesets)
          for (const maxTravelMin of [10, 30, 60])
            for (const budgetPerWeek of [0, 20])
              for (const prefersSmallGroups of [false, true]) {
                const p: Profile = { ...MAYA, mobility, transport, times, maxTravelMin, budgetPerWeek, prefersSmallGroups };
                for (const a of [...synthetic, ...ACTIVITIES]) {
                  if (checkActivity(p, a).some((x) => x.barrier?.severity === "hard")) continue;
                  for (const contacts of contactSets) {
                    checked++;
                    const prop = propose(p, a, contacts);
                    if (!prop.feasible) failures.push(`${JSON.stringify(p)} ${a.id} ${contacts.map((x) => x.id)}`);
                    else if (prop.actions.some((x) => x.scope.kind === "invite") && prop.actions.find((x) => x.scope.kind === "ride")?.scope.recipientId === prop.actions.find((x) => x.scope.kind === "invite")!.scope.recipientId)
                      failures.push(`invite==driver ${a.id}`);
                  }
                }
              }
    expect(checked).toBeGreaterThan(10_000);
    expect(failures.slice(0, 5)).toEqual([]);
  });
});
