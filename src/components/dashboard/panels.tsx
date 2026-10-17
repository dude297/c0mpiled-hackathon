"use client";

import { useState } from "react";
import { Ban, Calendar, Check, ChevronDown, CircleX, Hand, LoaderCircle, MapPin, Printer, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Interest, Mobility, TimeSlot, Transport, type AnalysisResult, type Profile } from "@/lib/schema";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-page mx-auto w-full max-w-5xl px-5 py-10 text-base md:px-8">
      <header className="mb-8">
        <p className="eyebrow">Discover & connect</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">A week to look forward to.</h1>
        <p className="mt-3 text-muted-foreground">Thoughtful matches, practical details, and a plan that fits your life.</p>
      </header>
      <div className="flex flex-col gap-4">{children}</div>
      <footer className="mt-8 text-center text-sm text-muted-foreground print:hidden">
        Explanations marked “mock AI” are canned; live AI comes from a real model.
      </footer>
    </div>
  );
}

function Chips<T extends string>(props: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 font-medium">{props.label}</legend>
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => {
          const on = props.value.includes(o);
          return (
            <label
              key={o}
              className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 text-base transition-colors focus-within:ring-3 focus-within:ring-ring/50 ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => props.onChange(on ? props.value.filter((x) => x !== o) : [...props.value, o])}
              />
              {o}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const inputCls = "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-base md:text-lg";

export function ProfilePanel(props: {
  value: Profile;
  onChange: (p: Profile) => void;
  onSubmit: () => void;
  onDemo: (key: string) => void;
  loading: boolean;
  error: string | null;
  hasResult?: boolean;
}) {
  const p = props.value;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => props.onChange({ ...p, [k]: v });
  const [open, setOpen] = useState(false);
  const hasResult = props.hasResult;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-xl">{hasResult ? "Change who we're planning for" : "Who are we planning for?"}</CardTitle>
        {hasResult && (
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="profile-fields">
            {open ? "Close" : "Edit"}
            <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </Button>
        )}
      </CardHeader>
      <CardContent id="profile-fields" className={`space-y-4 ${hasResult && !open ? "hidden" : ""}`}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => props.onDemo("margaret")} disabled={props.loading}>Load demo: Margaret</Button>
          <Button variant="outline" size="lg" onClick={() => props.onDemo("harold")} disabled={props.loading}>Load demo: Harold</Button>
        </div>
        <label className="block">
          <span className="mb-1.5 block font-medium">Name</span>
          <input className={inputCls} value={p.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <Chips label="Interests" options={Interest.options} value={p.interests} onChange={(v) => set("interests", v)} />
        <Chips label="Ways to get there" options={Transport.options} value={p.transport} onChange={(v) => set("transport", v)} />
        <Chips label="Available times" options={TimeSlot.options} value={p.times} onChange={(v) => set("times", v)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block font-medium">Mobility</span>
            <select className={inputCls} value={p.mobility} onChange={(e) => set("mobility", e.target.value as Profile["mobility"])}>
              {Mobility.options.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block font-medium">Max travel (min)</span>
            <input type="number" min={5} max={120} className={inputCls} value={p.maxTravelMin} onChange={(e) => set("maxTravelMin", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-medium">Budget ($/week)</span>
            <input type="number" min={0} max={500} className={inputCls} value={p.budgetPerWeek} onChange={(e) => set("budgetPerWeek", Number(e.target.value))} />
          </label>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5" checked={p.hearingImpaired} onChange={(e) => set("hearingImpaired", e.target.checked)} />
            Hard of hearing
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" className="size-5" checked={p.prefersSmallGroups} onChange={(e) => set("prefersSmallGroups", e.target.checked)} />
            Prefers small groups
          </label>
        </div>
        <Button className="w-full" size="xl" onClick={props.onSubmit} disabled={props.loading}>
          {props.loading ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Building plan…
            </>
          ) : (
            <>
              <Sparkles aria-hidden="true" />
              Build plan
            </>
          )}
        </Button>
        {props.error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-base text-destructive">
            <CircleX className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {props.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function PlanPanel({ result, loading, onSave }: { result: AnalysisResult | null; loading: boolean; onSave: () => Promise<void> }) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  async function handleSave() {
    try {
      setSaveState("saving");
      await onSave();
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  }
  return (
    <Card className="ring-primary/30">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-2xl">
          <Calendar className="size-6 text-primary" aria-hidden="true" />
          Weekly plan
          {result && (
            <Badge variant={result.dataSource === "mock" ? "secondary" : "default"} className="h-6 px-3 text-sm">
              {result.dataSource === "mock" ? "mock AI" : "live AI"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-base md:text-lg">
        {loading ? (
          <div className="flex items-center gap-3 py-8 text-muted-foreground" role="status" aria-live="polite">
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
            Building the plan…
          </div>
        ) : !result ? (
          <div className="rounded-xl border-2 border-dashed p-8 text-center">
            <p className="text-lg font-semibold">No plan yet</p>
            <p className="mt-1 text-base text-muted-foreground">
              Open the profile below, pick a demo, and hit Build plan — it takes one click.
            </p>
          </div>
        ) : result.plan.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed p-8 text-center" role="status">
            <p className="text-lg font-semibold">Nothing fit this week.</p>
            <p className="mt-1 text-base text-muted-foreground">
              Try more travel time, a bigger budget, or another way to get there — reasons below.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xl font-medium leading-snug md:text-2xl">{result.summary}</p>
            <div className="flex flex-wrap gap-2 text-sm md:text-base">
              {result.items.map((it) => (
                <span key={it.label} className="rounded-md border bg-muted/50 px-2.5 py-1.5">
                  {it.label}: <b>{it.value}</b>
                </span>
              ))}
            </div>
            <ul className="grid gap-3">
              {result.plan.map((i) => (
                <li key={i.activityId} className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-lg font-semibold md:text-xl">{i.name}</p>
                    <p className="text-sm text-muted-foreground md:text-base">
                      <b className="text-foreground">${i.costPerWeek}</b>/week
                    </p>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground md:text-base">
                    <span className="inline-flex items-center gap-1.5"><Calendar className="size-4" aria-hidden="true" />{i.when}</span>
                    <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" />{i.travel}</span>
                  </p>
                  {i.barriers.filter((b) => b.severity === "soft").map((b) => (
                    <p key={b.rule} className="mt-2 rounded-md bg-amber-100 p-2 text-sm dark:bg-amber-950/40 md:text-base">
                      <span className="font-medium text-amber-800 dark:text-amber-300">{b.detail}</span>
                      <span className="text-amber-800/80 dark:text-amber-300/80"> → </span>
                      {b.mitigation}
                    </p>
                  ))}
                  <a
                    href={`/coordinate?activityId=${i.activityId}`}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 md:text-base print:hidden"
                  >
                    <Hand className="size-4" aria-hidden="true" />
                    Get me there →
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-base text-muted-foreground md:text-lg">{result.explanation}</p>
              <div className="flex items-center gap-2 print:hidden">
                <Button variant="outline" size="lg" onClick={() => window.print()}>
                  <Printer aria-hidden="true" />
                  Print
                </Button>
                <Button size="lg" onClick={handleSave} disabled={saveState === "saving"}>
                  {saveState === "saving" ? "Saving…" : "Save & share"}
                </Button>
              </div>
            </div>
            {saveState === "error" && (
              <p role="alert" className="text-sm text-destructive md:text-base">Saving isn’t available yet — the share endpoint is coming soon.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function BlockedPanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Ban className="size-5 text-destructive" aria-hidden="true" />
          Why not these?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-base md:text-lg">
        {!result ? <p className="text-muted-foreground">Reasons appear here after a plan is built.</p> :
          !result.blocked.length ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="size-5 text-green-700 dark:text-green-400" aria-hidden="true" />
              Nothing was blocked — every match could be worked around.
            </p>
          ) : (
            result.blocked.map((b) => (
              <div key={b.name} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="font-semibold">{b.name}</p>
                <ul className="mt-1 space-y-1">
                  {b.barriers.map((x) => (
                    <li key={x.rule} className="flex items-start gap-2 font-medium text-destructive">
                      <CircleX className="mt-1 size-4 shrink-0" aria-hidden="true" />
                      {x.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
      </CardContent>
    </Card>
  );
}

export function EvidencePanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card>
      <CardContent>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Every check we ran ({result?.evidence.length ?? 0})
          </summary>
          <div className="mt-3 space-y-2 text-sm md:text-base">
            {!result?.evidence.length ? <p className="text-muted-foreground">No checks yet.</p> :
              result.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant={e.verified ? "default" : "destructive"} className="mt-0.5 gap-1">
                    {e.verified ? <Check aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                    {e.verified ? "pass" : "barrier"}
                  </Badge>
                  <span>
                    {e.claim} <span className="text-muted-foreground">({e.source})</span>
                  </span>
                </div>
              ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
