"use client";

import Link from "next/link";
import { Calendar, CircleX, Hand, MapPin, SearchX, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HandoffLinks } from "@/components/discovery/HandoffLinks";
import type { AnalysisResult, Barrier, PlanItem } from "@/lib/schema";

export const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export const costLabel = (n: number) => (n === 0 ? "Free" : `${money(n)}/week`);

export const softBarriers = (item: PlanItem): Barrier[] => item.barriers.filter((b) => b.severity === "soft");

export const hardBarriers = (barriers: Barrier[]): Barrier[] => barriers.filter((b) => b.severity === "hard");

export function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

function MatchCard({ item, added, onToggle, result }: { item: PlanItem; added: boolean; onToggle: () => void; result?: AnalysisResult }) {
  return (
    <li
      className={`rounded-2xl border-2 p-4 shadow-sm transition-colors md:p-5 ${added ? "border-primary bg-primary/5" : "border-dashed border-border bg-card"}`}
    >
      <h3 className="text-xl font-semibold leading-snug md:text-2xl">{item.name}</h3>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-base text-foreground/75 md:text-lg">
        <li className="inline-flex items-center gap-1.5"><Calendar className="size-5" aria-hidden="true" />{item.when}</li>
        <li className="inline-flex items-center gap-1.5"><MapPin className="size-5" aria-hidden="true" />{item.travel}</li>
        <li className="inline-flex items-center gap-1.5"><Wallet className="size-5" aria-hidden="true" /><b className="text-foreground">{costLabel(item.costPerWeek)}</b></li>
      </ul>
      {softBarriers(item).map((b) => (
        <p key={b.rule} className="mt-3 rounded-md bg-amber-100 p-3 text-base dark:bg-amber-950/40 md:text-lg">
          <span className="font-semibold text-amber-900 dark:text-amber-300">Heads up: </span>
          <span className="font-medium text-amber-900 dark:text-amber-300">{b.detail}</span>
          {b.mitigation && (
            <>
              <span className="text-amber-900/80 dark:text-amber-300/80" aria-hidden="true"> → </span>
              <span className="sr-only">. What helps: </span>
              {b.mitigation}
            </>
          )}
        </p>
      ))}
      <Button
        variant={added ? "outline" : "default"}
        aria-pressed={added}
        onClick={onToggle}
        className={`mt-4 h-14 w-full rounded-xl text-lg font-semibold focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground ${added ? "border-2 border-primary text-primary" : ""}`}
      >
        <span aria-hidden="true">{added ? "✓" : "❤️"}</span>
        {added ? "In my week" : "Add to my week"}
      </Button>
      <Link
        href={`/coordinate?activityId=${item.activityId}`}
        className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground print:hidden"
      >
        <Hand className="size-5" aria-hidden="true" />
        Get me there →
      </Link>
      <HandoffLinks item={item} result={result} />
    </li>
  );
}

export function MatchFeed({ result, added, onToggle }: { result: AnalysisResult; added: Set<string>; onToggle: (activityId: string) => void }) {
  return (
    <div className="space-y-8 text-base md:text-lg">
      <section aria-labelledby="matches-heading">
        <h2 id="matches-heading" className="mb-3 text-2xl font-semibold">Good matches</h2>
        {result.plan.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed p-8 text-center" role="status">
            <SearchX className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-xl font-semibold">Nothing fit this week.</p>
            <p className="mt-1 text-muted-foreground">
              Try allowing more travel time, a bigger budget, or another way to get there. You can change these under Details.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4">
            {result.plan.map((item) => (
              <MatchCard key={item.activityId} item={item} added={added.has(item.activityId)} onToggle={() => onToggle(item.activityId)} result={result} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="blocked-heading">
        <h2 id="blocked-heading" className="mb-3 text-2xl font-semibold">Not a match — here&apos;s why</h2>
        {result.blocked.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
            Nothing was ruled out — every option could be worked around.
          </p>
        ) : (
          <ul className="grid gap-3">
            {result.blocked.map((b) => (
              <li key={b.name} className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-lg font-semibold md:text-xl">{b.name}</p>
                <ul className="mt-1 space-y-1">
                  {hardBarriers(b.barriers).map((x) => (
                    <li key={x.rule} className="flex items-start gap-2 font-medium text-destructive">
                      <CircleX className="mt-1 size-5 shrink-0" aria-hidden="true" />
                      {x.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
