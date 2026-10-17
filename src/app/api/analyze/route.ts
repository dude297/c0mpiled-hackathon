import { runScenario } from "@/domain/engine";
import { getAiAdapter, mockAdapter } from "@/lib/ai/adapter";
import { enrichResult } from "@/lib/integrations/places";
import { ScenarioInput, type AnalysisResult } from "@/lib/schema";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = ScenarioInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const output = runScenario(parsed.data);
  let ai = getAiAdapter();
  // AI failure must not break the deterministic result; fall back to mock so the badge stays honest.
  const explanation = await ai.explain(parsed.data, output).catch((e) => {
    console.error("AI explain failed, using mock:", e instanceof Error ? e.message : e);
    ai = mockAdapter;
    return mockAdapter.explain(parsed.data, output);
  });

  const base: AnalysisResult = { ...output, explanation, dataSource: ai.name };
  // Enrichment is opt-in per DECISIONS.md: DAYBRIDGE_ENRICH=1 enables it with a total
  // time budget of 2.5 s. Tests/offline demos simply leave it unset.
  if (process.env.DAYBRIDGE_ENRICH !== "1") {
    return Response.json(base);
  }
  const { venueByItem, weather, evidence, rideshareByItem } = await Promise.race([
    enrichResult(base),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
  ]).then((r) => r ?? { venueByItem: {}, weather: null, evidence: base.evidence, rideshareByItem: {} });
  const result: AnalysisResult = { ...base, evidence };
  return Response.json({ ...result, venueByItem, weather, rideshareByItem });
}
