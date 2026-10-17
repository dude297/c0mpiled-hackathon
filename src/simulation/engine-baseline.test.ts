import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/domain/activities";
import { checkActivity, runScenario } from "@/domain/engine";
import type { Profile } from "@/lib/schema";

// Synthetic fixtures only. The real catalog (src/domain/activities.ts) is owned by
// Teammate B and must not be modified or imported for data here. Fixture injection
// uses vi.mock with a hoisted mutable array so every plan-level test exercises the
// REAL runScenario (no re-implementation of engine logic).

const fixtures = vi.hoisted(() => {
  const base: Activity = {
    id: "synthetic-1",
    name: "Synthetic Activity",
    tags: ["gardening"],
    day: "Mon",
    time: "morning",
    costPerWeek: 5,
    travelMin: { drive: 10 },
    stepFree: true,
    groupSize: "small",
    noisy: false,
    hearingLoop: false,
  };
  return { acts: [base] as Activity[] };
});

vi.mock("@/domain/activities", async (importOriginal) => {
  // Keep types from the real module; only replace the ACTIVITIES data.
  const real = await importOriginal<typeof import("@/domain/activities")>();
  return { ...real, ACTIVITIES: fixtures.acts };
});

const baseProfile: Profile = {
  name: "Test Person",
  interests: ["gardening"],
  mobility: "full",
  transport: ["drive"],
  maxTravelMin: 30,
  times: ["morning"],
  budgetPerWeek: 10,
  hearingImpaired: false,
  prefersSmallGroups: false,
};

const baseActivity: Activity = { ...fixtures.acts[0]! };

function setCatalog(acts: Activity[]) {
  fixtures.acts.length = 0;
  fixtures.acts.push(...acts);
}

afterEach(() => setCatalog([baseActivity]));

// Convenience: run the REAL engine against a temporary synthetic catalog.
function runWith(acts: Activity[], profile: Profile) {
  setCatalog(acts);
  return runScenario({ profile });
}

describe("Phase 1 baseline regression (synthetic fixtures, real engine)", () => {
  describe("mobility and accessibility constraints", () => {
    it("walker + stairs is a hard access barrier", () => {
      const checks = checkActivity(
        { ...baseProfile, mobility: "walker" },
        { ...baseActivity, stepFree: false },
      );
      const access = checks.find((c) => c.rule === "access");
      expect(access?.ok).toBe(false);
      expect(access?.barrier?.severity).toBe("hard");
    });

    it("wheelchair + stairs is a hard access barrier", () => {
      const checks = checkActivity(
        { ...baseProfile, mobility: "wheelchair" },
        { ...baseActivity, stepFree: false },
      );
      const access = checks.find((c) => c.rule === "access");
      expect(access?.ok).toBe(false);
      expect(access?.barrier?.severity).toBe("hard");
    });

    it("cane + stairs is only a soft barrier with a mitigation", () => {
      const checks = checkActivity(
        { ...baseProfile, mobility: "cane" },
        { ...baseActivity, stepFree: false },
      );
      const access = checks.find((c) => c.rule === "access");
      expect(access?.ok).toBe(true);
      expect(access?.barrier?.severity).toBe("soft");
      expect(access?.barrier?.mitigation).toBeTruthy();
    });

    it("step-free entrance passes access for every mobility level", () => {
      for (const mobility of ["full", "cane", "walker", "wheelchair"] as const) {
        const checks = checkActivity({ ...baseProfile, mobility }, baseActivity);
        expect(checks.find((c) => c.rule === "access")?.ok).toBe(true);
      }
    });
  });

  describe("transportation impossibilities", () => {
    it("no transport overlap means no route at all (hard barrier, no crash)", () => {
      const checks = checkActivity(
        { ...baseProfile, transport: ["walk"] },
        { ...baseActivity, travelMin: { drive: 10 } }, // activity offers no walk route
      );
      const transport = checks.find((c) => c.rule === "transport");
      expect(transport?.ok).toBe(false);
      expect(transport?.barrier?.severity).toBe("hard");
      expect(transport?.detail).toContain("No way to get there");
    });

    it("route exists but exceeds maxTravelMin (hard barrier)", () => {
      const checks = checkActivity(
        { ...baseProfile, transport: ["drive"], maxTravelMin: 5 },
        { ...baseActivity, travelMin: { drive: 40 } },
      );
      const transport = checks.find((c) => c.rule === "transport");
      expect(transport?.ok).toBe(false);
      expect(transport?.barrier?.severity).toBe("hard");
    });

    it("exact limit (route min === maxTravelMin) is feasible, not blocked", () => {
      const checks = checkActivity(
        { ...baseProfile, transport: ["drive"], maxTravelMin: 40 },
        { ...baseActivity, travelMin: { drive: 40 } },
      );
      expect(checks.find((c) => c.rule === "transport")?.ok).toBe(true);
    });

    it("prefers an independent mode over a family ride when both fit", () => {
      const checks = checkActivity(
        { ...baseProfile, transport: ["drive", "family"], maxTravelMin: 30 },
        { ...baseActivity, travelMin: { drive: 25, family: 10 } },
      );
      const transport = checks.find((c) => c.rule === "transport");
      expect(transport?.ok).toBe(true);
      expect(transport?.detail).toContain("drive"); // not family, despite being faster
    });

    it("walk is excluded as a mode when mobility makes walking impossible", () => {
      const checks = checkActivity(
        { ...baseProfile, mobility: "wheelchair", transport: ["walk", "drive"], maxTravelMin: 60 },
        { ...baseActivity, travelMin: { walk: 10, drive: 40 } },
      );
      const transport = checks.find((c) => c.rule === "transport");
      expect(transport?.ok).toBe(true);
      expect(transport?.detail).toContain("drive");
      expect(transport?.detail).not.toContain("walk");
    });
  });

  describe("schedule conflicts", () => {
    it("activity day/time outside available times is a hard barrier", () => {
      const checks = checkActivity(
        { ...baseProfile, times: ["evening"] },
        { ...baseActivity, time: "morning" },
      );
      const time = checks.find((c) => c.rule === "time");
      expect(time?.ok).toBe(false);
      expect(time?.barrier?.severity).toBe("hard");
    });

    it("any overlap of available times makes the activity time-feasible", () => {
      const checks = checkActivity(
        { ...baseProfile, times: ["morning", "evening"] },
        { ...baseActivity, time: "evening" },
      );
      expect(checks.find((c) => c.rule === "time")?.ok).toBe(true);
    });

    it("plan never places two activities on the same day", () => {
      const out = runWith(
        [
          { ...baseActivity, id: "s-a", name: "Act A", day: "Mon" },
          { ...baseActivity, id: "s-b", name: "Act B", day: "Tue" },
          { ...baseActivity, id: "s-c", name: "Act C", day: "Mon" },
        ],
        baseProfile,
      );
      const days = out.plan.map((i) => i.when.split(" ")[0]);
      expect(new Set(days).size).toBe(days.length);
    });
  });

  describe("budget limits and cumulative spending", () => {
    it("cost exceeding budget is a hard barrier even if everything else fits", () => {
      const checks = checkActivity(
        { ...baseProfile, budgetPerWeek: 3 },
        { ...baseActivity, costPerWeek: 5 },
      );
      const cost = checks.find((c) => c.rule === "cost");
      expect(cost?.ok).toBe(false);
      expect(cost?.barrier?.severity).toBe("hard");
    });

    it("plan cumulative cost never exceeds budget", () => {
      const out = runWith(
        [
          { ...baseActivity, id: "b-1", name: "B1", day: "Mon", costPerWeek: 6 },
          { ...baseActivity, id: "b-2", name: "B2", day: "Tue", costPerWeek: 6 },
          { ...baseActivity, id: "b-3", name: "B3", day: "Wed", costPerWeek: 6 },
        ],
        { ...baseProfile, budgetPerWeek: 10 },
      );
      expect(out.plan.reduce((s, i) => s + i.costPerWeek, 0)).toBeLessThanOrEqual(10);
      expect(out.plan).toHaveLength(1); // only one affordable activity fits
    });

    it("zero budget still yields a feasible free activity", () => {
      const out = runWith(
        [
          { ...baseActivity, id: "free-1", name: "Free Act", costPerWeek: 0, day: "Mon" },
          { ...baseActivity, id: "paid-1", name: "Paid Act", costPerWeek: 5, day: "Tue" },
        ],
        { ...baseProfile, budgetPerWeek: 0 },
      );
      expect(out.plan.map((i) => i.activityId)).toEqual(["free-1"]);
      expect(out.blocked.find((b) => b.name === "Paid Act")?.barriers).toContainEqual(
        expect.objectContaining({ rule: "cost", severity: "hard" }),
      );
    });

    it("greedy plan prefers the highest-scored affordable activity when budget forces a choice", () => {
      // "Pricey Match" scores higher (2 matching interests) but exceeds the budget
      // once chosen first; the greedy planner keeps the affordable one.
      const out = runWith(
        [
          { ...baseActivity, id: "cheap", name: "Cheap Match", costPerWeek: 2, day: "Mon", tags: ["gardening"] },
          { ...baseActivity, id: "pricey", name: "Pricey Match", costPerWeek: 9, day: "Tue", tags: ["gardening", "walking"] },
        ],
        { ...baseProfile, budgetPerWeek: 5 },
      );
      expect(out.plan[0]?.activityId).toBe("cheap");
    });
  });

  describe("no matching interests", () => {
    it("no interest overlap means empty plan, no blocked items, no fabricated evidence", () => {
      const out = runWith([baseActivity], { ...baseProfile, interests: ["tech"] });
      expect(out.plan).toHaveLength(0);
      expect(out.blocked).toHaveLength(0);
      expect(out.evidence).toHaveLength(0);
      expect(out.summary).toMatch(/No activity fits/i);
      expect(out.items.find((i) => i.label === "Matching interests")?.value).toBe("0");
    });
  });

  describe("deterministic ranking and consistent outcomes", () => {
    it("same input always yields the identical plan order and scores", () => {
      const acts: Activity[] = [
        { ...baseActivity, id: "d-1", name: "D1", day: "Mon", tags: ["gardening", "walking"] },
        { ...baseActivity, id: "d-2", name: "D2", day: "Tue", tags: ["gardening"] },
      ];
      const profile = { ...baseProfile, interests: ["gardening", "walking"] as Profile["interests"] };
      const r1 = runWith(acts, profile);
      const r2 = runWith(acts, profile);
      const r3 = runWith(acts, profile);
      expect(r1.plan).toEqual(r2.plan);
      expect(r2.plan).toEqual(r3.plan);
      // d-1 matches 2 interests so it must rank first; MAX_PLAN=3 allows both.
      expect(r1.plan.map((i) => i.activityId)).toEqual(["d-1", "d-2"]);
    });

    it("plan caps at three activities (MAX_PLAN) even with more feasible days", () => {
      const days = ["Mon", "Tue", "Wed", "Thu"] as const;
      const acts: Activity[] = days.map((day, i) => ({
        ...baseActivity, id: `cap-${i}`, name: `Cap ${i}`, day, costPerWeek: 0, tags: ["gardening"],
      }));
      const out = runWith(acts, baseProfile);
      expect(out.plan).toHaveLength(3); // MAX_PLAN = 3 in engine.ts
    });

    it("ranking is stable when two activities have identical scores (tie broken by id)", () => {
      const out1 = runWith(
        [
          { ...baseActivity, id: "zzz", name: "Z Act", day: "Mon" },
          { ...baseActivity, id: "aaa", name: "A Act", day: "Tue" },
        ],
        baseProfile,
      );
      const out2 = runWith(
        [
          { ...baseActivity, id: "zzz", name: "Z Act", day: "Mon" },
          { ...baseActivity, id: "aaa", name: "A Act", day: "Tue" },
        ],
        baseProfile,
      );
      expect(out1.plan.map((i) => i.activityId)).toEqual(["aaa", "zzz"]); // lexicographic tiebreak
      expect(out1.plan).toEqual(out2.plan);
    });

    it("travel time breaks a score tie between equally matching activities", () => {
      // Equal interests and no soft barriers: the nearer activity must rank first.
      const out = runWith(
        [
          { ...baseActivity, id: "far", name: "Far Act", day: "Mon", travelMin: { drive: 30 } },
          { ...baseActivity, id: "near", name: "Near Act", day: "Tue", travelMin: { drive: 10 } },
        ],
        baseProfile,
      );
      expect(out.plan[0]?.activityId).toBe("near");
      expect(out.plan[0]?.score).toBeGreaterThan(out.plan[1]?.score ?? 0);
    });

    it("soft barriers reduce score; a clean activity outranks an equally matching one with soft barriers", () => {
      const out = runWith(
        [
          { ...baseActivity, id: "noisy", name: "Noisy Act", noisy: true, day: "Mon", tags: ["gardening"] },
          { ...baseActivity, id: "quiet", name: "Quiet Act", noisy: false, day: "Tue", tags: ["gardening"] },
        ],
        { ...baseProfile, hearingImpaired: true },
      );
      expect(out.plan[0]?.activityId).toBe("quiet");
    });
  });

  describe("incorrect or misleading evidence", () => {
    it("every planned item has at least one verified evidence claim", () => {
      const out = runWith(
        [
          { ...baseActivity, id: "e-1", name: "E1", day: "Mon" },
          { ...baseActivity, id: "e-2", name: "E2", day: "Tue" },
        ],
        baseProfile,
      );
      expect(out.plan.length).toBeGreaterThan(0);
      for (const item of out.plan) {
        const claims = out.evidence.filter((e) => e.claim.startsWith(item.name));
        expect(claims.length).toBeGreaterThan(0);
        expect(claims.every((e) => e.verified)).toBe(true);
      }
    });

    it("blocked activities contribute only failed (unverified) evidence, never claimed as passing", () => {
      const out = runWith(
        [{ ...baseActivity, id: "bad", name: "Blocked Act", costPerWeek: 99, day: "Mon" }],
        baseProfile,
      );
      expect(out.plan).toHaveLength(0);
      for (const e of out.evidence) {
        expect(e.claim.startsWith("Blocked Act")).toBe(true);
        expect(e.verified).toBe(false);
        expect(e.source).toContain("rule:cost");
      }
    });

    it("no evidence claims reference activities outside the input catalog", () => {
      const out = runWith([{ ...baseActivity, id: "only", name: "Only Act", day: "Mon" }], baseProfile);
      for (const e of out.evidence) expect(e.claim.startsWith("Only Act")).toBe(true);
    });

    it("an infeasible activity is never presented as planned (no false success)", () => {
      const out = runWith(
        [
          { ...baseActivity, id: "good", name: "Good Act", day: "Mon" },
          { ...baseActivity, id: "bad", name: "Bad Act", stepFree: false, day: "Tue" },
        ],
        { ...baseProfile, mobility: "wheelchair" },
      );
      expect(out.plan.map((i) => i.activityId)).toEqual(["good"]);
      expect(out.blocked.find((b) => b.name === "Bad Act")).toBeDefined();
      // Cross-check: nothing in the plan appears in blocked and vice versa.
      const planNames = new Set(out.plan.map((i) => i.name));
      for (const b of out.blocked) expect(planNames.has(b.name)).toBe(false);
    });
  });

  describe("empty and invalid inputs", () => {
    it("single matching activity that is infeasible still yields structured, empty-plan output", () => {
      const out = runWith([{ ...baseActivity, id: "x", name: "X", costPerWeek: 50 }], {
        ...baseProfile,
        budgetPerWeek: 1,
      });
      expect(out.plan).toHaveLength(0);
      expect(out.blocked).toHaveLength(1);
      expect(out.summary).toBeTruthy();
      expect(out.items.length).toBe(5);
    });

    it("engine tolerates an empty times list without crashing (still returns a structured result)", () => {
      const out = runWith([baseActivity], {
        ...baseProfile,
        times: [], // Zod would reject this at the API edge; engine itself must not crash
      });
      expect(out.plan).toHaveLength(0);
      expect(out.blocked).toHaveLength(1);
    });

    it("zero maxTravelMin blocks all transport without crashing", () => {
      const out = runWith([baseActivity], { ...baseProfile, maxTravelMin: 0 });
      expect(out.plan).toHaveLength(0);
      expect(out.blocked).toHaveLength(1);
      expect(out.blocked[0]?.barriers.some((b) => b.rule === "transport")).toBe(true);
    });
  });
});
