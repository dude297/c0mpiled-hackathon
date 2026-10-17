import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import { AnalysisResult } from "@/lib/schema";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://test/api/analyze", { method: "POST", body: JSON.stringify(body) }));

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/analyze", () => {
  it("returns a schema-valid plan labeled mock when no AI is configured", async () => {
    vi.stubEnv("AI_BASE_URL", "");
    // Enrichment is opt-in (DAYBRIDGE_ENRICH); tests make zero network calls.
    vi.stubEnv("DAYBRIDGE_ENRICH", "");
    const res = await post({ profile: DEMO_PROFILES.margaret });
    expect(res.status).toBe(200);
    const data = AnalysisResult.parse(await res.json());
    expect(data.dataSource).toBe("mock");
    expect(data.plan.length).toBeGreaterThan(0);
  });

  it("falls back to mock when the live AI is unreachable", async () => {
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:1/v1");
    vi.stubEnv("DAYBRIDGE_ENRICH", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ profile: DEMO_PROFILES.margaret });
    expect(res.status).toBe(200);
    const data = AnalysisResult.parse(await res.json());
    expect(data.dataSource).toBe("mock");
    expect(data.explanation).toMatch(/^\[mock AI\]/);
  });

  it.each([{}, { profile: {} }, null])("rejects invalid input %j", async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});
