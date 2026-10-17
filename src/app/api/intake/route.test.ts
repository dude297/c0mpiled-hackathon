import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://test/api/intake", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/intake", () => {
  it("returns an unconfirmed rules suggestion without running the planner", async () => {
    vi.stubEnv("AI_BASE_URL", "");
    const res = await post({ text: "My mom Margaret loves gardening and uses a walker." });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      suggestion: { name: "Margaret", interests: ["gardening"], mobility: "walker" },
      confirmedFields: [],
      source: "rules",
      dataSource: "mock",
    });
    expect(data.uncertain).toEqual(["transport", "maxTravelMin", "times", "budgetPerWeek", "hearingImpaired", "prefersSmallGroups"]);
    expect(data).not.toHaveProperty("plan");
  });

  it.each([{}, { text: "" }, { text: "   " }, { text: 42 }, { text: "x".repeat(2001) }, null, "not json{"])(
    "rejects invalid body %j",
    async (body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    },
  );
});
