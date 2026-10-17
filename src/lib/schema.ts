import { z } from "zod";

// Generic contract between UI, API route, domain logic and AI adapter.
// Pivot: extend ScenarioInput with domain fields; keep AnalysisResult shape so panels keep working.

export const ScenarioInput = z.object({
  prompt: z.string().trim().min(1, "Describe a scenario").max(5000),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type ScenarioInput = z.infer<typeof ScenarioInput>;

export const Evidence = z.object({
  claim: z.string(),
  source: z.string(),
  verified: z.boolean(),
});
export type Evidence = z.infer<typeof Evidence>;

export const AnalysisResult = z.object({
  summary: z.string(),
  items: z.array(z.object({ label: z.string(), value: z.string() })),
  evidence: z.array(Evidence),
  explanation: z.string(),
  // "mock" = deterministic/fake data path, "live" = real AI/integration. Always shown in UI.
  dataSource: z.enum(["mock", "live"]),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;
