"use client";

import { useId, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Interest, Mobility, Profile, TimeSlot, Transport } from "@/lib/schema";
import { mergeSuggestion } from "./merge";

type Review = { draft: Profile; uncertain: string[]; notes: string[]; live: boolean };

const inputCls = "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-base md:text-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function CheckMark({ id }: { id: string }) {
  return (
    <span id={id} className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      <TriangleAlert className="size-3.5" aria-hidden="true" />
      Please check — not clearly stated
    </span>
  );
}

function Chips<T extends string>(props: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; flag?: string }) {
  return (
    <fieldset aria-describedby={props.flag}>
      <legend className="mb-1.5 font-medium">
        {props.label}
        {props.flag && <CheckMark id={props.flag} />}
      </legend>
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

export function IntakeReview(props: { base: Profile; onConfirm: (profile: Profile) => void; disabled?: boolean }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  async function suggest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setReview({
        draft: mergeSuggestion(props.base, data.suggestion),
        uncertain: Array.isArray(data.uncertain) ? data.uncertain.map(String) : [],
        notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
        live: data.dataSource === "live" && data.source === "llm",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function confirm() {
    if (!review) return;
    const r = Profile.safeParse(review.draft);
    if (!r.success) {
      const issue = r.error.issues[0];
      setError(`${issue?.path.join(".") || "Profile"}: ${issue?.message ?? "Invalid profile"}`);
      return;
    }
    setError(null);
    props.onConfirm(r.data);
  }

  const p = review?.draft;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setReview((r) => (r ? { ...r, draft: { ...r.draft, [k]: v } } : r));
  const flag = (k: keyof Profile) => (review?.uncertain.includes(k) ? `${uid}-${k}-check` : undefined);
  const textId = `${uid}-text`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Tell us about them</CardTitle>
        <CardDescription className="text-base">We suggest a profile from your words. You review and confirm it — nothing is planned until you do.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-base md:text-lg">
        <label htmlFor={textId} className="font-medium">Describe them in your own words</label>
        <Textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={4}
          className="min-h-28 text-base md:text-lg"
          placeholder="e.g. My mom Rosa loves gardening and music, uses a walker, takes the bus, mornings are best, about $15 a week."
        />
        <Button size="lg" className="min-h-11 self-start" onClick={suggest} disabled={loading || props.disabled || !text.trim()}>
          {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {loading ? "Reading…" : "Suggest profile"}
        </Button>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
            {error}
          </p>
        )}

        {review && p && (
          <section aria-label="Review suggested profile" className="flex flex-col gap-4 rounded-lg border p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold">Review before planning</h3>
              <Badge variant={review.live ? "default" : "secondary"}>{review.live ? "Suggested by AI" : "Suggested by rules (offline)"}</Badge>
            </div>
            <p className="text-muted-foreground">Nothing is applied yet. Check each field, fix anything wrong, then confirm.</p>

            {review.notes.length > 0 && (
              <div>
                <p className="font-medium">I heard…</p>
                <ul className="list-disc pl-6 text-muted-foreground">
                  {review.notes.map((n, i) => <li key={i}>{n.replace(/^I heard:\s*/, "")}</li>)}
                </ul>
              </div>
            )}

            <label className="block">
              <span className="mb-1.5 block font-medium">
                Name{flag("name") && <CheckMark id={flag("name")!} />}
              </span>
              <input className={inputCls} value={p.name} aria-describedby={flag("name")} onChange={(e) => set("name", e.target.value)} />
            </label>
            <Chips label="Interests" options={Interest.options} value={p.interests} onChange={(v) => set("interests", v)} flag={flag("interests")} />
            <Chips label="Ways to get there" options={Transport.options} value={p.transport} onChange={(v) => set("transport", v)} flag={flag("transport")} />
            <Chips label="Best times" options={TimeSlot.options} value={p.times} onChange={(v) => set("times", v)} flag={flag("times")} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block font-medium">Mobility{flag("mobility") && <CheckMark id={flag("mobility")!} />}</span>
                <select className={inputCls} value={p.mobility} aria-describedby={flag("mobility")} onChange={(e) => set("mobility", e.target.value as Profile["mobility"])}>
                  {Mobility.options.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block font-medium">Max travel (min){flag("maxTravelMin") && <CheckMark id={flag("maxTravelMin")!} />}</span>
                <input type="number" min={5} max={120} className={inputCls} value={p.maxTravelMin} aria-describedby={flag("maxTravelMin")} onChange={(e) => set("maxTravelMin", Number(e.target.value))} />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-medium">Budget ($/week){flag("budgetPerWeek") && <CheckMark id={flag("budgetPerWeek")!} />}</span>
                <input type="number" min={0} max={500} className={inputCls} value={p.budgetPerWeek} aria-describedby={flag("budgetPerWeek")} onChange={(e) => set("budgetPerWeek", Number(e.target.value))} />
              </label>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex min-h-11 flex-wrap items-center gap-2">
                <input type="checkbox" className="size-5" checked={p.hearingImpaired} aria-describedby={flag("hearingImpaired")} onChange={(e) => set("hearingImpaired", e.target.checked)} />
                Hard of hearing{flag("hearingImpaired") && <CheckMark id={flag("hearingImpaired")!} />}
              </label>
              <label className="flex min-h-11 flex-wrap items-center gap-2">
                <input type="checkbox" className="size-5" checked={p.prefersSmallGroups} aria-describedby={flag("prefersSmallGroups")} onChange={(e) => set("prefersSmallGroups", e.target.checked)} />
                Prefers small groups{flag("prefersSmallGroups") && <CheckMark id={flag("prefersSmallGroups")!} />}
              </label>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="lg" className="min-h-11" onClick={confirm} disabled={props.disabled}>Confirm and plan</Button>
              <Button size="lg" variant="outline" className="min-h-11" onClick={() => { setReview(null); setError(null); }}>Discard</Button>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
