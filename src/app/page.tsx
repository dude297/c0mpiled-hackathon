"use client";

import { useState } from "react";
import { DashboardShell, EvidencePanel, ResultPanel, ScenarioPanel } from "@/components/dashboard/panels";
import type { AnalysisResult } from "@/lib/schema";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardShell>
      <ScenarioPanel value={prompt} onChange={setPrompt} onSubmit={run} loading={loading} error={error} />
      <ResultPanel result={result} />
      <EvidencePanel result={result} />
    </DashboardShell>
  );
}
