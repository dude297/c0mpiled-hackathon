import { runScenario } from "@/domain/engine";
import { getAiAdapter } from "@/lib/ai/adapter";
import { ScenarioInput, type AnalysisResult } from "@/lib/schema";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = ScenarioInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const output = runScenario(parsed.data);
  const ai = getAiAdapter();
  // AI failure must not break the deterministic result.
  const explanation = await ai.explain(parsed.data, output).catch(() => "Explanation unavailable.");

  const result: AnalysisResult = { ...output, explanation, dataSource: ai.name };
  return Response.json(result);
}
