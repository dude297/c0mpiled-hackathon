"use client";

import { useEffect, useRef, useState } from "react";
import { CircleX, LoaderCircle, Printer, RotateCcw } from "lucide-react";
import { DashboardShell, EvidencePanel, ProfilePanel } from "@/components/dashboard/panels";
import { IntakeReview } from "@/components/intake/IntakeReview";
import { ShareControl } from "@/components/share/ShareControl";
import { WeekCalendar, weekSummary } from "@/components/calendar/WeekCalendar";
import { MatchFeed, hardBarriers, toggleInSet } from "@/components/feed/MatchFeed";
import { CardDeck } from "@/components/onboarding/CardDeck";
import { Hero } from "@/components/hero/Hero";
import { PlanStages } from "@/components/hero/PlanStages";
import { DiscoveryFeed } from "@/components/discovery/DiscoveryFeed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, Profile } from "@/lib/schema";

const TABS = ["matches", "week", "details"] as const;
type Tab = (typeof TABS)[number];

const FRIENDLY_ERROR = "Our planner is having a moment — please try again.";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

export default function Home() {
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILES.margaret);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"onboarding" | "dashboard">("onboarding");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("matches");
  const [announce, setAnnounce] = useState("");
  const reqId = useRef(0);
  const focusNext = useRef<"tab" | "summary" | null>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);

  // Move focus once the element we want exists (after a run finishes rendering).
  useEffect(() => {
    if (!focusNext.current) return;
    const el = focusNext.current === "tab" ? document.getElementById("tab-matches") : summaryRef.current;
    if (el) {
      el.focus();
      focusNext.current = null;
    }
  });

  async function run(p: Profile = profile) {
    const id = ++reqId.current;
    const rebuilding = result !== null;
    // integration: /coordinate reads this so "Get me there" plans for the same person (session-only, no PII leaves the browser).
    try {
      sessionStorage.setItem("daybridge:profile", JSON.stringify(p));
    } catch {}
    setLoading(true);
    setError(null);
    setAnnounce("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
      });
      const data = await res.json().catch(() => null);
      if (id !== reqId.current) return; // stale: start over or a newer run happened
      if (!res.ok || !data) throw new Error(FRIENDLY_ERROR);
      setResult(data);
      setAdded(new Set((data as AnalysisResult).plan.map((i) => i.activityId)));
      setTab("matches");
      setMode("dashboard");
      setAnnounce("Plan updated");
      focusNext.current = rebuilding ? "tab" : "summary";
    } catch {
      if (id !== reqId.current) return;
      setError(FRIENDLY_ERROR);
      setMode("dashboard");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  function demo(key: string) {
    const p = DEMO_PROFILES[key];
    setProfile(p);
    setMode("dashboard");
    run(p);
  }

  // Always mounted (first child of every render) so announcements aren't lost on remount.
  const withLive = (node: React.ReactNode) => (
    <>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      {node}
    </>
  );

  // Hero "Start": bring the deck into view and put keyboard/screen-reader focus on its current card.
  function startDeck() {
    const deck = deckRef.current;
    if (!deck) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    deck.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    deck.querySelector<HTMLElement>("[data-step-focus]")?.focus({ preventScroll: true });
  }

  if (mode === "onboarding") {
    return withLive(
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <Hero onStart={startDeck} onDemo={() => demo("margaret")} loading={loading} />
        <div ref={deckRef} className="scroll-mt-4">
          <CardDeck
            onComplete={(p) => {
              setProfile(p);
              run(p);
            }}
            loading={loading}
            onDemo={demo}
          />
        </div>
        {(loading || error) && (
          <div className="mx-auto mt-4 max-w-3xl">
            <PlanStages loading={loading} result={null} error={error} />
          </div>
        )}
        {error && <p className="mx-auto max-w-md text-center text-destructive">{error}</p>}
        <div className="pt-6 text-center">
          <button
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-base text-foreground underline underline-offset-4 ${FOCUS}`}
            onClick={() => setMode("dashboard")}
          >
            Or use the classic form
          </button>
        </div>
      </div>,
    );
  }

  function startOver() {
    reqId.current++; // ignore any in-flight response
    setLoading(false);
    setResult(null);
    setError(null);
    setAnnounce("");
    focusNext.current = null;
    setMode("onboarding");
  }

  // Errors are shown by the page's own error box / summary strip, so ProfilePanel doesn't announce them twice.
  const details = (
    <>
      <ProfilePanel value={profile} onChange={setProfile} onSubmit={() => run()} onDemo={demo} loading={loading} error={null} hasResult={result !== null} />
      <IntakeReview base={profile} disabled={loading} onConfirm={(p) => { setProfile(p); run(p); }} />
      {result && <EvidencePanel result={result} />}
    </>
  );

  if (!result) {
    return withLive(
      <DashboardShell>
        {loading ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center">
            <LoaderCircle className="size-10 animate-spin text-primary" aria-hidden="true" />
            <p className="text-xl font-semibold">Building {profile.name}&apos;s week…</p>
            <p className="text-muted-foreground">Checking times, travel, cost and access for every activity.</p>
          </div>
        ) : null}
        {(loading || error) && <PlanStages loading={loading} result={null} error={error} />}
        {loading ? null : error ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
            <p className="flex items-center gap-2 text-xl font-semibold text-destructive">
              <CircleX className="size-6 shrink-0" aria-hidden="true" />
              We couldn&apos;t build the plan
            </p>
            <p className="mt-1">{error} Your answers are still here.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="lg" className={FOCUS} onClick={() => run()}>Try again</Button>
              <Button size="lg" variant="outline" className={FOCUS} onClick={startOver}>Start over</Button>
            </div>
          </div>
        ) : (
          <p className="text-lg text-muted-foreground">Fill in the form below, or load a demo, then press Build plan.</p>
        )}
        {!loading && details}
      </DashboardShell>,
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

  return withLive(
    <DashboardShell>
      <PlanStages loading={loading} result={result} error={error} />
      <section aria-label="Plan summary" className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-foreground/75">Suggested plan</p>
            <h2 ref={summaryRef} tabIndex={-1} className="text-xl font-medium leading-snug outline-none md:text-2xl">
              {result.summary}
            </h2>
          </div>
          <Badge variant={result.dataSource === "mock" ? "secondary" : "default"} className="h-7 px-3 text-sm">
            {result.dataSource === "mock" ? "mock AI" : "live AI"}
          </Badge>
        </div>
        <p className="mt-2 text-muted-foreground">{result.explanation}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm md:text-base">
          <span className="font-semibold text-foreground/75">Suggested:</span>
          {result.items.map((it) => (
            <span key={it.label} className="rounded-md border bg-muted/50 px-2.5 py-1.5">
              {it.label}: <b>{/^\$0(\.0+)?$/.test(it.value) ? "Free" : it.value}</b>
            </span>
          ))}
        </div>
        <p className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-lg font-semibold md:text-xl">
          In your week:{" "}
          <span key={addedItems.length} className="db-pop inline-block">{weekSummary(addedItems)}</span>
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" size="lg" className={FOCUS} onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            Print
          </Button>
          <Button variant="ghost" size="lg" className={FOCUS} onClick={startOver} disabled={loading}>
            <RotateCcw aria-hidden="true" />
            Start over
          </Button>
        </div>
        {error && !loading && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
            <CircleX className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>We couldn&apos;t update the plan. {error} The plan below is your last one.</span>
          </p>
        )}
        {loading && (
          <p role="status" className="mt-3 flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Updating the plan…
          </p>
        )}
      </section>

      <ShareControl result={result} />

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
            className={`min-h-12 rounded-lg px-2 text-base font-semibold outline-none transition-colors md:text-lg ${FOCUS} ${tab === t ? "bg-background text-foreground shadow-sm" : "text-foreground/75 hover:text-foreground"}`}
          >
            {labels[t]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="dash-panel" aria-labelledby={`tab-${tab}`} tabIndex={0} className={`flex flex-col gap-4 rounded-xl outline-none print:hidden ${FOCUS}`}>
        <div key={tab} className="db-fade-up flex flex-col gap-4">
        {tab === "matches" && <MatchFeed result={result} added={added} onToggle={(id) => setAdded((s) => toggleInSet(s, id))} />}
        {tab === "week" &&
          (addedItems.length ? (
            <WeekCalendar items={addedItems} />
          ) : (
            <div className="rounded-xl border-2 border-dashed p-8 text-center">
              <p className="text-xl font-semibold">Your week is empty</p>
              <p className="mt-1 text-muted-foreground">Go to Matches and tap “Add to my week” on anything that sounds good.</p>
              <Button size="lg" className={`mt-4 ${FOCUS}`} onClick={() => setTab("matches")}>See matches</Button>
            </div>
          ))}
        {tab === "details" && details}
        </div>
      </div>

      {/* Separate from the personalized plan: public listings, not checked for fit. */}
      <DiscoveryFeed />

      {/* Print-only: same output whichever tab is open. */}
      <div className="hidden print:block">
        <h2 className="mb-2 text-2xl font-semibold">{profile.name}&apos;s week</h2>
        {addedItems.length ? <WeekCalendar items={addedItems} /> : <p>No outings added yet.</p>}
        <h2 className="mb-2 mt-6 text-xl font-semibold">Not a match — why</h2>
        {result.blocked.length === 0 ? (
          <p>Nothing was ruled out.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {result.blocked.map((b) => (
              <li key={b.name}>
                <b>{b.name}</b>: {hardBarriers(b.barriers).map((x) => x.detail).join("; ")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>,
  );
}
