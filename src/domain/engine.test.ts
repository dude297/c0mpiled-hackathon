import { describe, expect, it } from "vitest";
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import { checkActivity, runScenario } from "@/domain/engine";
import type { Profile } from "@/lib/schema";

const margaret = DEMO_PROFILES.margaret;
const byId = (id: string) => ACTIVITIES.find((a) => a.id === id)!;

describe("DayBridge engine", () => {
  it("is deterministic", () => {
    expect(runScenario({ profile: margaret })).toEqual(runScenario({ profile: margaret }));
  });

  it("never plans choir for Margaret (stairs + walker) and explains why", () => {
    const out = runScenario({ profile: margaret });
    expect(out.plan.map((i) => i.activityId)).not.toContain("choir");
    const choir = out.blocked.find((b) => b.name === byId("choir").name);
    expect(choir?.barriers).toContainEqual(expect.objectContaining({ rule: "access", severity: "hard" }));
  });

  it.each(Object.entries(DEMO_PROFILES))("plan for %s respects days, budget, size and interests", (_, profile) => {
    const { plan } = runScenario({ profile });
    expect(plan.length).toBeLessThanOrEqual(3);
    const days = plan.map((i) => i.when.split(" ")[0]);
    expect(new Set(days).size).toBe(days.length);
    expect(plan.reduce((s, i) => s + i.costPerWeek, 0)).toBeLessThanOrEqual(profile.budgetPerWeek);
    for (const item of plan) expect(byId(item.activityId).tags.some((t) => profile.interests.includes(t))).toBe(true);
  });

  it("flags a hard cost barrier when the budget is zero", () => {
    const checks = checkActivity({ ...margaret, budgetPerWeek: 0 }, byId("garden"));
    expect(checks).toContainEqual(expect.objectContaining({ rule: "cost", ok: false }));
  });

  it.each(["walker", "wheelchair"] as const)("never routes a %s user on foot", (mobility) => {
    const profile: Profile = { ...margaret, mobility, transport: ["walk"], interests: ["walking", "gardening", "cards"] };
    const out = runScenario({ profile });
    expect(out.plan).toHaveLength(0);
    for (const b of out.blocked) expect(b.barriers.some((x) => x.rule === "transport")).toBe(true);
  });
});
