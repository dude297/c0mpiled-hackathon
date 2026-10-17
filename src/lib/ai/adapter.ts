import type { DomainOutput } from "@/domain/engine";
import type { ScenarioInput } from "@/lib/schema";

// AI explains deterministic results; it never produces the results themselves.
export interface AiAdapter {
  name: "mock" | "live";
  explain(input: ScenarioInput, output: DomainOutput): Promise<string>;
}

export const mockAdapter: AiAdapter = {
  name: "mock",
  async explain(_input, output) {
    return `[mock AI] ${output.summary} ${output.evidence.length} evidence item(s) attached.`;
  },
};

// ponytail: mock only. Add a live adapter here (server-side key via AI_API_KEY) when the idea is chosen.
export function getAiAdapter(): AiAdapter {
  return mockAdapter;
}
