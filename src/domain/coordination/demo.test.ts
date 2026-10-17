import { describe, expect, it } from "vitest";
import { ACTIVITIES, type Activity } from "@/domain/activities";
import { DEMO_SCENARIOS, resolveDemoActivity } from "./demo";
import { propose } from "./planner";

const { profile, contacts } = DEMO_SCENARIOS.maya;
// Synthetic catalog: "fellowship" yields ride + invite; "b-ride" only a ride (small group); "a-stairs" is blocked.
const base: Activity = { id: "fellowship", name: "Sunday Lunch", tags: ["faith"], day: "Sun", time: "afternoon", costPerWeek: 5, travelMin: { family: 10, paratransit: 30 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: true };
const RIDE_ONLY: Activity = { ...base, id: "b-ride", groupSize: "small" };
const BOTH: Activity = { ...base, id: "c-both" };
const STAIRS: Activity = { ...base, id: "a-stairs", stepFree: false };
const kinds = (id: string, catalog: Activity[]) => {
  const p = propose(profile, catalog.find((a) => a.id === id)!, contacts);
  return p.feasible ? p.actions.map((a) => a.scope.kind).sort() : [];
};

describe("resolveDemoActivity", () => {
  it("keeps the preferred activity while it yields a ride and an invite", () => {
    const catalog = [STAIRS, RIDE_ONLY, base];
    expect(kinds("fellowship", catalog)).toEqual(["invite", "ride"]);
    expect(resolveDemoActivity(catalog, profile, contacts)).toBe("fellowship");
  });

  it("falls back to the first (by id) ride+invite activity when the preferred one is gone", () => {
    expect(resolveDemoActivity([STAIRS, BOTH, RIDE_ONLY], profile, contacts)).toBe("c-both");
  });

  it("falls back to a ride-only activity when the preferred one no longer qualifies", () => {
    const catalog = [STAIRS, RIDE_ONLY, { ...base, groupSize: "small" as const, travelMin: { bus: 5 } }];
    expect(kinds("b-ride", catalog)).toEqual(["ride"]);
    expect(resolveDemoActivity(catalog, profile, contacts)).toBe("b-ride");
  });

  it("returns null when nothing in the catalog needs a ride", () => {
    expect(resolveDemoActivity([STAIRS], profile, contacts)).toBeNull();
  });

  it("finds a ride activity in the real catalog", () => {
    const id = resolveDemoActivity(ACTIVITIES, profile, contacts);
    expect(id).not.toBeNull();
    expect(kinds(id!, ACTIVITIES)).toContain("ride");
  });
});
