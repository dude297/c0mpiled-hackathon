"use client";

import { useState } from "react";
import { BlockedPanel, DashboardShell, EvidencePanel, PlanPanel, ProfilePanel } from "@/components/dashboard/panels";
import { CardDeck } from "@/components/onboarding/CardDeck";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, Profile } from "@/lib/schema";

export default function Home() {
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILES.margaret);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"onboarding" | "dashboard">("onboarding");

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
      setMode("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setMode("dashboard");
    } finally {
      setLoading(false);
    }
  }

  function demo(key: string) {
    const p = DEMO_PROFILES[key];
    setProfile(p);
    setMode("dashboard");
    run(p);
  }

  if (mode === "onboarding") {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-semibold">DayBridge</h1>
          <p className="text-muted-foreground">
            Find the social activities you&apos;ll actually love — and can actually get to.
          </p>
        </header>
        <CardDeck
          onComplete={(p) => {
            setProfile(p);
            run(p);
          }}
          loading={loading}
        />
        {error && <p className="mx-auto max-w-md text-center text-destructive">{error}</p>}
        <div className="pt-6 text-center">
          <button className="text-sm text-muted-foreground underline" onClick={() => setMode("dashboard")}>
            Or use the classic form
          </button>
        </div>
      </div>
    );
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
