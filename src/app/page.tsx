"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleX, LoaderCircle, Printer, RotateCcw, Share2 } from "lucide-react";
import { DashboardShell, EvidencePanel, IntakeSlot, ProfilePanel } from "@/components/dashboard/panels";
import { WeekCalendar } from "@/components/calendar/WeekCalendar";
import { MatchFeed, toggleInSet } from "@/components/feed/MatchFeed";
import { CardDeck } from "@/components/onboarding/CardDeck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, Profile } from "@/lib/schema";

const TABS = ["matches", "week", "details"] as const;
type Tab = (typeof TABS)[number];

export default function Home() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILES.margaret);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"onboarding" | "dashboard">("onboarding");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("matches");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

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
      setAdded(new Set((data as AnalysisResult).plan.map((i) => i.activityId)));
      setTab("matches");
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

  async function handleSave() {
    setSaveState("saving");
    try {
      await savePlan();
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  }

  function startOver() {
    setResult(null);
    setError(null);
    setSaveState("idle");
    setMode("onboarding");
  }

  const details = (
    <>
      <IntakeSlot onIntake={intake} />
      <ProfilePanel value={profile} onChange={setProfile} onSubmit={() => run()} onDemo={demo} loading={loading} error={error} hasResult={result !== null} />
      {result && <EvidencePanel result={result} />}
    </>
  );

  if (!result) {
    return (
      <DashboardShell>
        {loading ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center">
            <LoaderCircle className="size-10 animate-spin text-primary" aria-hidden="true" />
            <p className="text-xl font-semibold">Building {profile.name}&apos;s week…</p>
            <p className="text-muted-foreground">Checking times, travel, cost and access for every activity.</p>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
            <p className="flex items-center gap-2 text-xl font-semibold text-destructive">
              <CircleX className="size-6 shrink-0" aria-hidden="true" />
              We couldn&apos;t build the plan
            </p>
            <p className="mt-1">Something went wrong on our side ({error}). Your answers are still here.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="lg" onClick={() => run()}>Try again</Button>
              <Button size="lg" variant="outline" onClick={startOver}>Start over</Button>
            </div>
          </div>
        ) : (
          <p className="text-lg text-muted-foreground">Fill in the form below, or load a demo, then press Build plan.</p>
        )}
        {!loading && details}
      </DashboardShell>
    );
  }

  const addedItems = result.plan.filter((p) => added.has(p.activityId));
  const labels: Record<Tab, string> = { matches: "Matches", week: `My week (${addedItems.length})`, details: "Details" };

  function onTabKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <DashboardShell>
      <section aria-label="Plan summary" className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xl font-medium leading-snug md:text-2xl">{result.summary}</p>
          <Badge variant={result.dataSource === "mock" ? "secondary" : "default"} className="h-7 px-3 text-sm">
            {result.dataSource === "mock" ? "mock AI" : "live AI"}
          </Badge>
        </div>
        <p className="mt-2 text-muted-foreground">{result.explanation}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm md:text-base">
          {result.items.map((it) => (
            <span key={it.label} className="rounded-md border bg-muted/50 px-2.5 py-1.5">
              {it.label}: <b>{it.value}</b>
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="lg" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            Print
          </Button>
          <Button size="lg" onClick={handleSave} disabled={saveState === "saving"}>
            <Share2 aria-hidden="true" />
            {saveState === "saving" ? "Saving…" : "Save & share"}
          </Button>
          <Button variant="ghost" size="lg" onClick={startOver}>
            <RotateCcw aria-hidden="true" />
            Start over
          </Button>
        </div>
        {saveState === "error" && (
          <p role="alert" className="mt-3 rounded-md bg-destructive/10 p-3 text-destructive">
            We couldn&apos;t save a share link just now. You can still print the plan, or try again in a moment.
          </p>
        )}
        {loading && (
          <p role="status" className="mt-3 flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Updating the plan…
          </p>
        )}
      </section>

      <div role="tablist" aria-label="Plan views" onKeyDown={onTabKey} className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 print:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={tab === t}
            aria-controls="dash-panel"
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            className={`min-h-12 rounded-lg px-2 text-base font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:text-lg ${tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {labels[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="dash-panel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="flex flex-col gap-4 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {tab === "matches" && <MatchFeed result={result} added={added} onToggle={(id) => setAdded((s) => toggleInSet(s, id))} />}
        {tab === "week" &&
          (addedItems.length ? (
            <WeekCalendar items={addedItems} />
          ) : (
            <div className="rounded-xl border-2 border-dashed p-8 text-center">
              <p className="text-xl font-semibold">Your week is empty</p>
              <p className="mt-1 text-muted-foreground">Go to Matches and tap “Add to my week” on anything that sounds good.</p>
              <Button size="lg" className="mt-4" onClick={() => setTab("matches")}>See matches</Button>
            </div>
          ))}
        {tab === "details" && details}
      </div>
    </DashboardShell>
  );
}
