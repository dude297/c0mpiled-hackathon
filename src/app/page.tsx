"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BlockedPanel, DashboardShell, EvidencePanel, IntakeSlot, PlanPanel, ProfilePanel } from "@/components/dashboard/panels";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, Profile } from "@/lib/schema";

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILES.margaret);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(p: Profile = profile) {
    // integration: /coordinate reads this so "Get me there" plans for the same person (session-only, no PII leaves the browser).
    try {
      sessionStorage.setItem("daybridge:profile", JSON.stringify(p));
    } catch {}
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

  async function intake(text: string) {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    setProfile(data.profile);
    run(data.profile);
  }

  async function savePlan() {
    if (!result) return;
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, result }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    router.push(`/plan/${data.id}`);
  }

  return (
    <DashboardShell>
      <PlanPanel result={result} loading={loading} onSave={savePlan} />
      <BlockedPanel result={result} />
      <IntakeSlot onIntake={intake} />
      <ProfilePanel value={profile} onChange={setProfile} onSubmit={() => run()} onDemo={demo} loading={loading} error={error} hasResult={result !== null} />
      <EvidencePanel result={result} />
    </DashboardShell>
  );
}
