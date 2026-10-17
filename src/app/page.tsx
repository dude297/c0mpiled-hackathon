"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BlockedPanel, DashboardShell, EvidencePanel, IntakeSlot, PlanPanel, ProfilePanel } from "@/components/dashboard/panels";
import { CardDeck } from "@/components/onboarding/CardDeck";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, Profile } from "@/lib/schema";

export default function Home() {
  const router = useRouter();
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
      <PlanPanel result={result} loading={loading} onSave={savePlan} />
      <BlockedPanel result={result} />
      <IntakeSlot onIntake={intake} />
      <ProfilePanel value={profile} onChange={setProfile} onSubmit={() => run()} onDemo={demo} loading={loading} error={error} hasResult={result !== null} />
      <EvidencePanel result={result} />
    </DashboardShell>
  );
}
