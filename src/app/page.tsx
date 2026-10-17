"use client";

import { useState } from "react";
import { BlockedPanel, DashboardShell, EvidencePanel, PlanPanel, ProfilePanel } from "@/components/dashboard/panels";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, Profile } from "@/lib/schema";

export default function Home() {
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILES.margaret);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(p: Profile = profile) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
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

  function demo(key: string) {
    const p = DEMO_PROFILES[key];
    setProfile(p);
    run(p);
  }

  return (
    <DashboardShell>
      <ProfilePanel value={profile} onChange={setProfile} onSubmit={() => run()} onDemo={demo} loading={loading} error={error} />
      <PlanPanel result={result} />
      <BlockedPanel result={result} />
      <EvidencePanel result={result} />
    </DashboardShell>
  );
}
