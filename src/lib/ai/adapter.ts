import type { DomainOutput } from "@/domain/engine";
import type { ScenarioInput } from "@/lib/schema";

// AI explains deterministic results; it never produces the results themselves.
export interface AiAdapter {
  name: "mock" | "live";
  explain(input: ScenarioInput, output: DomainOutput): Promise<string>;
}

export const mockAdapter: AiAdapter = {
  name: "mock",
  async explain({ profile }, output) {
    if (!output.plan.length) {
      return `[mock AI] Nothing fits ${profile.name}'s week yet. ${output.blocked.length} matching activit${output.blocked.length === 1 ? "y is" : "ies are"} blocked; see the reasons below.`;
    }
    const workarounds = output.plan.reduce((n, i) => n + i.barriers.length, 0);
    return `[mock AI] Suggested for ${profile.name}: ${output.plan.map((i) => `${i.name} (${i.when})`).join(", ")}. ${workarounds} barrier(s) need a workaround, and ${output.blocked.length} other activit${output.blocked.length === 1 ? "y was" : "ies were"} ruled out.`;
  },
};

const SYSTEM_PROMPT =
  "You help caregivers plan social activities for older adults. Write a warm, plain-language explanation of 3 to 5 sentences addressed to the caregiver. " +
  "Use ONLY facts in the JSON you are given: the planned activities, their barriers and mitigations, and the blocked activities with their reasons. " +
  "Never invent activities, times, costs or places. No lists, no headings.";

// OpenAI-compatible endpoint, e.g. `wally serve qwen3-4b-instruct-2507` → http://127.0.0.1:8080/v1
export const liveAdapter: AiAdapter = {
  name: "live",
  async explain({ profile }, output) {
    const res = await fetch(`${process.env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.AI_API_KEY ? { Authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "qwen3-4b-instruct-2507",
        temperature: 0.2,
        max_tokens: 250,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ person: profile.name, plan: output.plan, blocked: output.blocked }) },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw new Error("AI returned an empty explanation");
    return text;
  },
};

export function getAiAdapter(): AiAdapter {
  return process.env.AI_BASE_URL ? liveAdapter : mockAdapter;
}
