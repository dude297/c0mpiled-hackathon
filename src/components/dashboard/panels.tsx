"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Interest, Mobility, TimeSlot, Transport, type AnalysisResult, type Profile } from "@/lib/schema";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl p-6 text-base">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">DayBridge</h1>
        <p className="text-muted-foreground">
          Turns an older adult&apos;s interests and real-life barriers into a weekly social plan they can actually follow.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Chips<T extends string>(props: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 font-medium">{props.label}</legend>
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => {
          const on = props.value.includes(o);
          return (
            <label key={o} className={`cursor-pointer rounded-full border px-3 py-1 ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
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

const inputCls = "w-full rounded-md border bg-background px-3 py-2";

export function ProfilePanel(props: {
  value: Profile;
  onChange: (p: Profile) => void;
  onSubmit: () => void;
  onDemo: (key: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const p = props.value;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => props.onChange({ ...p, [k]: v });
  return (
    <Card>
      <CardHeader><CardTitle>Who are we planning for?</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => props.onDemo("margaret")} disabled={props.loading}>Load demo: Margaret</Button>
          <Button variant="outline" onClick={() => props.onDemo("harold")} disabled={props.loading}>Load demo: Harold</Button>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium">Name</span>
          <input className={inputCls} value={p.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <Chips label="Interests" options={Interest.options} value={p.interests} onChange={(v) => set("interests", v)} />
        <Chips label="Ways to get there" options={Transport.options} value={p.transport} onChange={(v) => set("transport", v)} />
        <Chips label="Available times" options={TimeSlot.options} value={p.times} onChange={(v) => set("times", v)} />
        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className="mb-1 block font-medium">Mobility</span>
            <select className={inputCls} value={p.mobility} onChange={(e) => set("mobility", e.target.value as Profile["mobility"])}>
              {Mobility.options.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block font-medium">Max travel (min)</span>
            <input type="number" min={5} max={120} className={inputCls} value={p.maxTravelMin} onChange={(e) => set("maxTravelMin", Number(e.target.value))} />
          </label>
          <label>
            <span className="mb-1 block font-medium">Budget ($/week)</span>
            <input type="number" min={0} max={500} className={inputCls} value={p.budgetPerWeek} onChange={(e) => set("budgetPerWeek", Number(e.target.value))} />
          </label>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-5" checked={p.hearingImpaired} onChange={(e) => set("hearingImpaired", e.target.checked)} />
            Hard of hearing
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-5" checked={p.prefersSmallGroups} onChange={(e) => set("prefersSmallGroups", e.target.checked)} />
            Prefers small groups
          </label>
        </div>
        <Button size="lg" onClick={props.onSubmit} disabled={props.loading}>{props.loading ? "Building plan..." : "Build plan"}</Button>
        {props.error && <p className="text-destructive">{props.error}</p>}
      </CardContent>
    </Card>
  );
}

export function PlanPanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Weekly plan
          {result && (
            <Badge variant={result.dataSource === "mock" ? "secondary" : "default"}>
              {result.dataSource === "mock" ? "mock AI" : "live AI"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result ? <p className="text-muted-foreground">Load a demo or fill the profile, then build a plan.</p> : (
          <>
            <p className="text-lg font-medium">{result.summary}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {result.items.map((it) => (
                <span key={it.label} className="rounded-md border px-2 py-1">{it.label}: <b>{it.value}</b></span>
              ))}
            </div>
            {result.plan.map((i) => (
              <div key={i.activityId} className="rounded-lg border p-3">
                <p className="font-semibold">{i.name}</p>
                <p className="text-sm text-muted-foreground">{i.when} · {i.travel} · ${i.costPerWeek}/week</p>
                {i.barriers.filter((b) => b.severity === "soft").map((b) => (
                  <p key={b.rule} className="mt-1 text-sm">
                    <span className="text-amber-700 dark:text-amber-400">{b.detail}</span> → {b.mitigation}
                  </p>
                ))}
              </div>
            ))}
            <div>
              <p className="font-medium">AI explanation</p>
              <p className="text-muted-foreground">{result.explanation}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function BlockedPanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card className="md:col-span-2">
      <CardHeader><CardTitle>Why not these?</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {!result?.blocked.length ? <p className="text-muted-foreground">Nothing blocked.</p> :
          result.blocked.map((b) => (
            <div key={b.name}>
              <span className="font-medium">{b.name}</span>
              <ul className="ml-5 list-disc text-muted-foreground">
                {b.barriers.map((x) => <li key={x.rule}>{x.detail}</li>)}
              </ul>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

export function EvidencePanel({ result }: { result: AnalysisResult | null }) {
  return (
    <Card className="md:col-span-2">
      <CardContent>
        <details>
          <summary className="cursor-pointer font-medium">Every check we ran ({result?.evidence.length ?? 0})</summary>
          <div className="mt-3 space-y-2 text-sm">
            {!result?.evidence.length ? <p className="text-muted-foreground">No checks yet.</p> :
              result.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant={e.verified ? "default" : "destructive"}>{e.verified ? "pass" : "barrier"}</Badge>
                  <span>{e.claim} <span className="text-muted-foreground">({e.source})</span></span>
                </div>
              ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
