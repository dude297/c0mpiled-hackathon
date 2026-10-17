"use client";

// Small pieces shared by the Matches, Calendar and Profile views.
import { TriangleAlert } from "lucide-react";
import { FOCUS } from "@/components/shell/focus";
import { personLabel, useDeviceStore } from "@/components/shell/store";
import type { Barrier } from "@/lib/schema";
import { headsUpText } from "./format";

/** Heads-up row: white, 4px amber left rule, icon + word. Never an amber fill. */
export function HeadsUpRow({ barrier }: { barrier: Barrier }) {
  const { detail, tip } = headsUpText(barrier);
  return (
    <p className="flex items-start gap-2 border-l-4 border-amber-600 py-1 pl-3 dark:border-amber-400">
      <TriangleAlert className="mt-1 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
      <span>
        <span className="font-semibold">Heads up: </span>
        {detail}.{tip && <> {tip}.</>}
      </span>
    </p>
  );
}

/** One quiet line, shown once per screen, when the active person is a sample (demo data). */
export function SampleNote() {
  const s = useDeviceStore();
  if (s.person === "me") return null;
  return <p className="text-base text-muted-foreground">{personLabel(s)} is a sample person (demo data).</p>;
}

/** Inline analyze state: "Finding activities…" in place, or one friendly error line + Try again. No full-page loader. */
export function AnalyzeLine() {
  const { analyzing, error, analyze } = useDeviceStore();
  if (analyzing) {
    return (
      <p role="status" className="text-foreground/80">
        Finding activities you can get to…
      </p>
    );
  }
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p>{error}</p>
      <button
        type="button"
        onClick={() => void analyze()}
        className={`inline-flex min-h-11 items-center rounded-xl border px-4 font-semibold hover:bg-muted ${FOCUS}`}
      >
        Try again
      </button>
    </div>
  );
}

export const PRIMARY_BTN = `inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground hover:bg-primary/85 disabled:opacity-50 ${FOCUS}`;
export const SECONDARY_BTN = `inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border px-5 text-lg font-medium hover:bg-muted ${FOCUS}`;
export const QUIET_LINK = `inline-flex min-h-11 items-center gap-1 rounded-lg text-lg font-medium text-primary underline-offset-4 hover:underline ${FOCUS}`;
