import { DEMO_PROFILES } from "@/domain/activities";
import type { Coordinator } from "@/domain/coordination/coordinator";
import type { Profile } from "@/lib/schema";
import type { Grant, Person } from "./contract";
import type { CaregiverStore } from "./store";

// Fictional demo fixtures. Fixed person ids so re-seeding replaces the previous demo people.
export const DEMO_USERS = { dana: "cg-dana", lee: "cg-lee", selfMaya: "self-maya" } as const;
export const DEMO_PEOPLE = { maya: "7d1f0a52-4c1e-4b8a-9a0e-6d6179610001", margaret: "7d1f0a52-4c1e-4b8a-9a0e-6d6172670002" } as const;

export const MAYA_PROFILE: Profile = {
  name: "Maya", interests: ["faith"], mobility: "walker", transport: ["family", "paratransit"],
  maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 10, hearingImpaired: false, prefersSmallGroups: true,
};
export const MAYA_CONTACTS = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];

const DAY_MS = 86_400_000;
type Coord = Pick<Coordinator, "create" | "command">;

export async function seedFixtures({ store, coordinator, now = new Date() }: { store: CaregiverStore; coordinator: Coord; now?: Date }) {
  for (const id of Object.values(DEMO_PEOPLE)) await store.deletePerson(id);
  const at = now.toISOString();
  const grant = (personId: string, userId: string, scopes: Grant["scopes"]): Grant => ({ personId, userId, scopes, grantedBy: DEMO_USERS.dana, grantedAt: at });

  const maya: Person = {
    personId: DEMO_PEOPLE.maya, profile: MAYA_PROFILE, timezone: "America/Los_Angeles", selfUserId: DEMO_USERS.selfMaya,
    checkInSchedule: { everyDays: 3 }, createdAt: new Date(now.getTime() - 7 * DAY_MS).toISOString(), createdBy: DEMO_USERS.dana,
  };
  const margaret: Person = {
    personId: DEMO_PEOPLE.margaret, profile: DEMO_PROFILES.margaret, timezone: "America/New_York",
    checkInSchedule: null, createdAt: at, createdBy: DEMO_USERS.dana,
  };
  await store.createPerson(maya, grant(maya.personId, DEMO_USERS.dana, ["view", "checkin", "manage"]));
  await store.createPerson(margaret, grant(margaret.personId, DEMO_USERS.dana, ["view", "checkin", "manage"]));
  await store.upsertGrant(grant(margaret.personId, DEMO_USERS.lee, ["view"]));

  // Maya: fellowship accepted → AWAITING_APPROVAL (needs ride + invite approval).
  const mayaPlan = (await coordinator.create({ profile: maya.profile, activityId: "fellowship", contacts: MAYA_CONTACTS })).plan.id;
  await store.linkPlan({ personId: maya.personId, planId: mayaPlan, linkedAt: at, linkedBy: DEMO_USERS.dana });
  const mayaState = (await coordinator.command(mayaPlan, { type: "accept_proposal" })).plan.state;

  // Margaret: bridge (bus, small group) needs no external dependencies → READY on accept.
  const margaretPlan = (await coordinator.create({ profile: margaret.profile, activityId: "bridge", contacts: [] })).plan.id;
  await store.linkPlan({ personId: margaret.personId, planId: margaretPlan, linkedAt: at, linkedBy: DEMO_USERS.dana });
  const margaretState = (await coordinator.command(margaretPlan, { type: "accept_proposal" })).plan.state;

  // One caregiver "ok" check-in 4 days ago: with everyDays 3, Maya is overdue.
  await store.recordCheckin({
    checkInId: crypto.randomUUID(), personId: maya.personId, kind: "ok", reporterUserId: DEMO_USERS.dana, reporterRole: "caregiver",
    source: "demo", at: new Date(now.getTime() - 4 * DAY_MS).toISOString(), idempotencyKey: `demo-seed-${now.getTime()}`,
  });

  return {
    users: DEMO_USERS,
    people: { maya: { personId: maya.personId, planId: mayaPlan, state: mayaState }, margaret: { personId: margaret.personId, planId: margaretPlan, state: margaretState } },
  };
}
