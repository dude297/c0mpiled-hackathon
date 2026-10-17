"use client";

import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { AnalysisResult } from "@/lib/schema";

type State = "done" | "active" | "failed";

// Stages flip only on the real /api/analyze fetch lifecycle: sent → (one request: engine + explanation) → response.
// No timers: while the request is in flight both server steps show "working", because both happen inside it.
export function PlanStages({ loading, result, error }: { loading: boolean; result: AnalysisResult | null; error: string | null }) {
  const failed = !loading && !!error;
  if (!loading && !result && !failed) return null;
  const done = !loading && !failed && !!result;
  const num = (label: string) => result?.items.find((i) => i.label === label)?.value;
  const checked = num("Matching interests") ?? String((result?.plan.length ?? 0) + (result?.blocked.length ?? 0));
  const ai = result?.dataSource === "live" ? "Live AI" : "Sample text (mock, no live AI)";

  const stages: { title: string; detail: string; state: State }[] = [
    { title: "Your answers", detail: "Sent", state: "done" },
    {
      title: done ? `Checked ${checked} activities` : "Checking activities",
      detail: done
        ? `${num("Feasible") ?? result!.plan.length} fit · ${num("Blocked") ?? result!.blocked.length} ruled out`
        : failed ? "Couldn't finish" : "Times, travel, cost, access…",
      state: done ? "done" : failed ? "failed" : "active",
    },
    {
      title: done ? "Explained your plan" : "Explaining your plan",
      detail: done ? ai : failed ? "Not finished" : "Working…",
      state: done ? "done" : failed ? "failed" : "active",
    },
  ];

  return (
    <ol aria-label="Planning progress" className="grid gap-2 sm:grid-cols-3 print:hidden">
      {stages.map((s, i) => (
        <li
          key={i}
          className={`flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors motion-reduce:transition-none ${
            s.state === "done" ? "db-pop border-green-800/30 bg-green-50 dark:bg-green-950/40" : s.state === "failed" ? "border-destructive/40 bg-destructive/5" : "bg-card"
          }`}
        >
          {s.state === "done" ? (
            <CircleCheck className="size-6 shrink-0 text-green-800 dark:text-green-400" aria-hidden="true" />
          ) : s.state === "failed" ? (
            <CircleX className="size-6 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <LoaderCircle className="size-6 shrink-0 animate-spin text-foreground/70 motion-reduce:animate-none" aria-hidden="true" />
          )}
          <span className="min-w-0 leading-tight">
            <span className="block font-semibold">{s.title}</span>
            <span className="block text-base text-foreground/75">
              <span className="sr-only">{s.state === "done" ? "Done: " : s.state === "failed" ? "Stopped: " : "In progress: "}</span>
              {s.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
