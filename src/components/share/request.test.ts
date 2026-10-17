import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/lib/schema";
import { buildShareRequest, describeShareStatus, describeStopStatus, isMemoryStore, resultForWeek } from "./request";

const result: AnalysisResult = { summary: "Ana's plan", items: [], plan: [], blocked: [], evidence: [], explanation: "x", dataSource: "mock" };

describe("buildShareRequest", () => {
  it("shares only My week, preserving the analysis and supporting an empty week", () => {
    const item = { activityId: "art", name: "Art", when: "Sat afternoon", travel: "walk", costPerWeek: 0, score: 1, barriers: [] };
    const full = { ...result, plan: [item, { ...item, activityId: "music" }] };
    const subset = resultForWeek(full, new Set(["music", "unknown"]));
    expect(buildShareRequest(subset, false).result.plan.map((i) => i.activityId)).toEqual(["music"]);
    expect(subset.summary).toBe(full.summary);
    expect(full.plan).toHaveLength(2);
    expect(resultForWeek(full, new Set()).plan).toEqual([]);
  });
  it("has exactly {result, consent:true, firstNameOnly} and no profile", () => {
    const body = buildShareRequest(result, true);
    expect(Object.keys(body).sort()).toEqual(["consent", "firstNameOnly", "result"]);
    expect(body).toEqual({ result, consent: true, firstNameOnly: true });
    expect("profile" in body).toBe(false);
    expect(JSON.parse(JSON.stringify(buildShareRequest(result, false)))).not.toHaveProperty("profile");
  });
});

describe("status outcomes", () => {
  it("maps share statuses", () => {
    expect(describeShareStatus(201).kind).toBe("ok");
    expect(describeShareStatus(503)).toEqual({ kind: "unavailable", message: "Sharing isn't available on this deployment yet." });
    expect(describeShareStatus(400).kind).toBe("error");
    expect(describeShareStatus(413).kind).toBe("error");
    expect(describeShareStatus(500).kind).toBe("error");
  });
  it("maps stop statuses", () => {
    expect(describeStopStatus(204).message).toBe("Link turned off.");
    expect(describeStopStatus(404).message).toBe("Link already expired or turned off.");
    expect(describeStopStatus(503).kind).toBe("unavailable");
    expect(describeStopStatus(500).kind).toBe("error");
  });
  it("treats missing storage as memory", () => {
    const c = { id: "a", url: "/plan/a", revokeToken: "t", expiresAt: "2026-01-01T00:00:00Z" };
    expect(isMemoryStore(c)).toBe(true);
    expect(isMemoryStore({ ...c, storage: "db" })).toBe(false);
  });
});
