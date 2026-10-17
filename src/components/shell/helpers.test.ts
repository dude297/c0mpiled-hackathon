import { describe, expect, it } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, PlanItem } from "@/lib/schema";
import {
  KEYS, coordinateHref, friendlyAnalyzeError, parseActive, parsePlans, parseProfile, parseResult, parseWeek,
  planStatusView, profileHash, readPlanResponse, reconcileWeek, toggleId,
} from "./helpers";

const item = (activityId: string, name: string): PlanItem => ({ activityId, name, when: "Wed afternoon", travel: "Bus, 15 min", costPerWeek: 0, score: 1, barriers: [] });
const result = (plan: PlanItem[], blocked: AnalysisResult["blocked"] = []): AnalysisResult => ({
  summary: "s", items: [], plan, blocked, evidence: [], explanation: "e", dataSource: "mock",
});

describe("keys", () => {
  it("match the spec", () => {
    expect(KEYS.active).toBe("daybridge:v1:active");
    expect(KEYS.profile("margaret")).toBe("daybridge:v1:margaret:profile");
    expect(KEYS.plans("me")).toBe("daybridge:v1:me:plans");
  });
});

describe("parsers drop bad data", () => {
  it("active", () => {
    expect(parseActive('{"person":"harold","mode":"caregiver"}')).toEqual({ person: "harold", mode: "caregiver" });
    expect(parseActive('{"person":"harold"}')).toEqual({ person: "harold", mode: "user" });
    expect(parseActive('{"person":"bob"}')).toBeNull();
    expect(parseActive("not json")).toBeNull();
    expect(parseActive(null)).toBeNull();
  });
  it("profile is zod-validated", () => {
    expect(parseProfile(JSON.stringify(DEMO_PROFILES.margaret))).toEqual(DEMO_PROFILES.margaret);
    expect(parseProfile(JSON.stringify({ ...DEMO_PROFILES.margaret, interests: [] }))).toBeNull();
  });
  it("result needs a hash and a valid AnalysisResult", () => {
    const r = result([item("a", "A")]);
    expect(parseResult(JSON.stringify({ result: r, profileHash: "x" }))).toEqual({ result: r, profileHash: "x" });
    expect(parseResult(JSON.stringify({ result: r }))).toBeNull();
    expect(parseResult(JSON.stringify({ result: { plan: 1 }, profileHash: "x" }))).toBeNull();
  });
  it("week: null when never stored, de-duplicated strings otherwise", () => {
    expect(parseWeek(null)).toBeNull();
    expect(parseWeek('["a","a",3,"b"]')).toEqual(["a", "b"]);
    expect(parseWeek("{}")).toBeNull();
  });
  it("plans keeps string ids only", () => {
    expect(parsePlans('{"a":"p1","b":2,"c":""}')).toEqual({ a: "p1" });
    expect(parsePlans("[]")).toEqual({});
  });
});

describe("profileHash", () => {
  it("ignores key and array order", () => {
    const p = DEMO_PROFILES.margaret;
    const shuffled = { ...p, interests: [...p.interests].reverse(), transport: [...p.transport].reverse() };
    expect(profileHash(shuffled)).toBe(profileHash(p));
  });
  it("changes when an answer changes", () => {
    expect(profileHash({ ...DEMO_PROFILES.margaret, maxTravelMin: 45 })).not.toBe(profileHash(DEMO_PROFILES.margaret));
  });
});

describe("reconcileWeek", () => {
  const prev = result([item("choir", "Choir"), item("cards", "Cards")]);
  it("first analyze adds every plan item", () => {
    expect(reconcileWeek(null, null, prev)).toEqual({ week: ["choir", "cards"], dropped: [] });
  });
  it("keeps ids still in the plan and reports the ones that fell out with their reason", () => {
    const next = result([item("cards", "Cards"), item("yoga", "Yoga")], [
      { name: "Choir", barriers: [{ rule: "soft", severity: "soft", detail: "noisy" }, { rule: "steps", severity: "hard", detail: "Entrance has stairs" }] },
    ]);
    expect(reconcileWeek(["choir", "cards"], prev, next)).toEqual({
      week: ["cards"],
      dropped: [{ activityId: "choir", name: "Choir", reason: "Entrance has stairs" }],
    });
  });
  it("does not add new plan items to an existing week", () => {
    expect(reconcileWeek([], prev, prev).week).toEqual([]);
  });
});

describe("toggleId", () => {
  it("adds and removes", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("readPlanResponse", () => {
  it("404 → gone, 503 → unavailable, 500 → error", () => {
    expect(readPlanResponse("p", 404, null)).toEqual({ kind: "gone" });
    expect(readPlanResponse("p", 503, null)).toEqual({ kind: "unavailable" });
    expect(readPlanResponse("p", 500, null)).toEqual({ kind: "error" });
  });
  it("reads the state; CANCELLED counts as Not started", () => {
    expect(readPlanResponse("p", 200, { state: "READY" })).toEqual({ kind: "ok", status: { state: "READY", planId: "p", plan: null } });
    expect(readPlanResponse("p", 200, { state: "CANCELLED" })).toEqual({ kind: "ok", status: { state: null, planId: null, plan: null } });
    expect(readPlanResponse("p", 200, { state: "WEIRD" })).toEqual({ kind: "error" });
  });
});

describe("planStatusView", () => {
  it("never shows raw state names and always pairs attention states with an icon", () => {
    for (const s of ["BLOCKED", "PROPOSED", "AWAITING_APPROVAL", "PENDING_CONFIRMATION", "READY", "NEEDS_REPLAN", "COMPLETED", null] as const) {
      const v = planStatusView(s);
      expect(v.word).not.toMatch(/[A-Z]{3,}|_/);
      if (v.attention) expect(v.icon).not.toBeNull();
    }
  });
  it("uses the spec words", () => {
    expect(planStatusView(null)).toMatchObject({ word: "Not started", action: "Get me there", resume: false });
    expect(planStatusView("NEEDS_REPLAN")).toMatchObject({ word: "Needs a new plan", action: "Fix my plan", attention: 1 });
    expect(planStatusView("AWAITING_APPROVAL", "caregiver", "Margaret").word).toBe("Needs Margaret's OK");
    expect(planStatusView("COMPLETED").action).toBeNull();
  });
});

describe("coordinateHref", () => {
  it("adds planId only when resuming", () => {
    expect(coordinateHref("choir")).toBe("/coordinate?activityId=choir");
    expect(coordinateHref("choir", "p 1")).toBe("/coordinate?activityId=choir&planId=p+1");
  });
});

describe("friendlyAnalyzeError", () => {
  it("never leaks status codes", () => {
    for (const s of [null, 400, 500]) expect(friendlyAnalyzeError(s)).not.toMatch(/\d{3}/);
  });
});
