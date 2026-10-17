import { describe, expect, it } from "vitest";
import type { AnalysisResult, Profile } from "@/lib/schema";
import { analysisHandoff, coordinationProfile } from "./handoff";

const profile: Profile = {
  name: "Ana", interests: ["crafts"], mobility: "full", transport: ["walk"],
  maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20,
  hearingImpaired: false, prefersSmallGroups: true,
};
const result: AnalysisResult = {
  summary: "Ana's plan", items: [], blocked: [], evidence: [], explanation: "", dataSource: "mock",
  plan: [{ activityId: "art", name: "Art", when: "Sat afternoon", travel: "walk", costPerWeek: 0, score: 1, barriers: [] }],
};
const analyzedAt = "2026-10-17T12:00:00.000Z";

describe("analysis coordination handoff", () => {
  it("records the analyzed person, timestamp and result activity ids", () => {
    expect(analysisHandoff(profile, result, analyzedAt)).toEqual({ profile, analyzedAt, resultActivityIds: ["art"] });
  });

  it("reads the new handoff only for an activity in its analysis", () => {
    const raw = JSON.stringify(analysisHandoff(profile, result, analyzedAt));
    expect(coordinationProfile(raw, "art")).toEqual(profile);
    expect(coordinationProfile(raw, "other")).toBeNull();
    expect(coordinationProfile(raw, null)).toBeNull();
    expect(coordinationProfile(raw, "")).toBeNull();
  });

  it("keeps legacy plain profiles compatible without substituting a demo", () => {
    expect(coordinationProfile(JSON.stringify(profile), "art")).toEqual(profile);
    expect(coordinationProfile(JSON.stringify(profile), null)).toBeNull();
  });

  it.each([null, "", "{", "null", "[]", '{"name":"Maya"}'])("rejects missing or malformed storage: %s", (raw) => {
    expect(coordinationProfile(raw, "art")).toBeNull();
  });

  it("fails closed for invalid new records and an empty analysis", () => {
    const handoff = analysisHandoff(profile, result, analyzedAt);
    for (const invalid of [
      { ...handoff, resultActivityIds: [] },
      { ...handoff, resultActivityIds: null },
      { ...handoff, analyzedAt: "invalid" },
      { ...handoff, profile: { ...profile, name: "" } },
      { profile },
    ]) expect(coordinationProfile(JSON.stringify(invalid), "art")).toBeNull();
  });
});
