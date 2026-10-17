import { describe, expect, it } from "vitest";
import { runScenario } from "@/domain/engine";
import { AnalysisResult } from "@/lib/schema";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://test/api/analyze", { method: "POST", body: JSON.stringify(body) }));

describe("domain engine", () => {
  it("is deterministic", () => {
    const input = { prompt: "Hello world. Second one!" };
    expect(runScenario(input)).toEqual(runScenario(input));
    expect(runScenario(input).items[0].value).toBe("4");
  });
});

describe("POST /api/analyze", () => {
  it("returns a schema-valid result labeled with its data source", async () => {
    const res = await post({ prompt: "Plan a visit. Check transport." });
    expect(res.status).toBe(200);
    const data = AnalysisResult.parse(await res.json());
    expect(data.dataSource).toBe("mock");
    expect(data.evidence).toHaveLength(2);
  });

  it.each([{}, { prompt: "   " }, null])("rejects invalid input %j", async (body) => {
    expect((await post(body)).status).toBe(400);
  });
});
