import type { Activity } from "@/domain/activities";
import type { Contact, Profile } from "@/lib/schema";
import { propose } from "./planner";

// Seeded demo scenarios for the coordination flow (see docs/handoffs/teammate-c-coordination-ui.md).
export const DEMO_SCENARIOS = {
  maya: {
    activityId: "fellowship",
    profile: {
      name: "Maya", interests: ["faith"], mobility: "walker", transport: ["family", "paratransit"],
      maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 10, hearingImpaired: false, prefersSmallGroups: true,
    },
    contacts: [
      { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
      { id: "dan", name: "Dan", relation: "son", canDrive: true },
    ],
  },
} satisfies Record<string, { activityId: string; profile: Profile; contacts: Contact[] }>;
export type DemoScenarioId = keyof typeof DEMO_SCENARIOS;

const actionKinds = (a: Activity, profile: Profile, contacts: Contact[]) => {
  const p = propose(profile, a, contacts);
  return p.feasible ? new Set(p.actions.map((x) => x.scope.kind)) : new Set<string>();
};

// The activity catalog is human-owned and may change. Keep the demo working: use the preferred activity if it
// still yields a ride + invite, else the first activity (by id) that does, else the first with at least a ride.
export function resolveDemoActivity(catalog: Activity[], profile: Profile, contacts: Contact[], preferredId: string = DEMO_SCENARIOS.maya.activityId): string | null {
  const both = (a: Activity) => {
    const k = actionKinds(a, profile, contacts);
    return k.has("ride") && k.has("invite");
  };
  const preferred = catalog.find((a) => a.id === preferredId);
  if (preferred && both(preferred)) return preferred.id;
  const sorted = [...catalog].sort((x, y) => x.id.localeCompare(y.id));
  return (sorted.find(both) ?? sorted.find((a) => actionKinds(a, profile, contacts).has("ride")))?.id ?? null;
}
