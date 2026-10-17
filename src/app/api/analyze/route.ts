import { runScenario } from "@/domain/engine";
import { getAiAdapter, mockAdapter } from "@/lib/ai/adapter";
import { enrichResult } from "@/lib/integrations/places";
import { withEnrichmentBudget } from "@/lib/integrations/budget";
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
  // Optional enrichment has a one-second budget (below DECISIONS.md's 2.5 s cap).
  if (process.env.DAYBRIDGE_ENRICH !== "1") {
    return Response.json(base);
  }
  const { venueByItem, weather, evidence, rideshareByItem } =
    await withEnrichmentBudget((signal) => enrichResult(base, signal)) ??
    { venueByItem: {}, weather: null, evidence: base.evidence, rideshareByItem: {} };
  const result: AnalysisResult = { ...base, evidence };
  return Response.json({ ...result, venueByItem, weather, rideshareByItem });
}
