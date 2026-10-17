import type { Evidence, ScenarioInput } from "@/lib/schema";

// Deterministic, correctness-critical logic lives in src/domain. No AI calls here.
// ponytail: placeholder engine (word stats); replace with DayBridge/AskFirst/GhostProtocol logic once chosen.

export type DomainOutput = {
  summary: string;
  items: { label: string; value: string }[];
  evidence: Evidence[];
};

export function runScenario(input: ScenarioInput): DomainOutput {
  const words = input.prompt.split(/\s+/).filter(Boolean);
  const sentences = input.prompt.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return {
    summary: `Scenario with ${words.length} words across ${sentences.length} sentence(s).`,
    items: [
      { label: "Words", value: String(words.length) },
      { label: "Sentences", value: String(sentences.length) },
    ],
    evidence: sentences.map((s, i) => ({
      claim: s,
      source: `input:sentence-${i + 1}`,
      verified: true, // directly derived from user input
    })),
  };
}
