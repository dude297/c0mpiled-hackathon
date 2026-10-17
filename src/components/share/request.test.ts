import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/lib/schema";
import { buildShareRequest, describeShareStatus, describeStopStatus, isMemoryStore } from "./request";

const result: AnalysisResult = { summary: "Ana's plan", items: [], plan: [], blocked: [], evidence: [], explanation: "x", dataSource: "mock" };

describe("buildShareRequest", () => {
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
