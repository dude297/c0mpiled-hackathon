"use client";

import { ArrowDown, Car, Compass, Play, RefreshCw, Scale, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

// What DayBridge actually does, in order (discover → reason → coordinate → adapt). Icons are decorative.
const STEPS = [
  { icon: Compass, label: "Finds activities" },
  { icon: Scale, label: "Checks what fits" },
  { icon: Car, label: "Plans the ride" },
  { icon: RefreshCw, label: "Adjusts if plans change" },
] as const;

// Compact hero above the onboarding deck: brand, benefit, and the two ways in. Kept short so the first card stays near the fold.
export function Hero({ onStart, onDemo, loading }: { onStart: () => void; onDemo: () => void; loading: boolean }) {
  return (
    <header className="db-fade-up mb-5 rounded-3xl border bg-card px-4 py-4 shadow-sm md:px-7 md:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          DayBridge
        </p>
        <ul aria-label="How DayBridge helps" className="hidden flex-wrap gap-2 lg:flex">
          {STEPS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-base">
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance md:text-3xl">
            Find activities you&apos;ll love — and actually get to.
          </h1>
          <p className="mt-1.5 text-base text-foreground/80 md:text-lg">
            A few quick cards. We check times, travel, cost and access — then help plan the ride.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button size="lg" className={`min-h-12 flex-1 rounded-xl px-6 text-lg md:flex-none ${FOCUS}`} onClick={onStart}>
            <ArrowDown aria-hidden="true" />
            Start
          </Button>
          <Button
            size="lg"
            variant="outline"
            className={`min-h-12 flex-1 rounded-xl px-6 text-lg md:flex-none ${FOCUS}`}
            onClick={onDemo}
            disabled={loading}
          >
            <Play aria-hidden="true" />
            Try demo
          </Button>
        </div>
      </div>
    </header>
  );
}
