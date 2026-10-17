"use client";

// Small shared pieces for U2 / U5, following UX-GUIDE "Surfaces" (plain rows, amber left rule, one primary).
import Link from "next/link";
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { FOCUS } from "@/components/shell/focus";

export const PRIMARY = `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground hover:bg-primary/85 sm:w-auto ${FOCUS}`;
export const QUIET_LINK = `inline-flex min-h-11 items-center rounded-md font-medium underline underline-offset-4 hover:text-foreground/75 ${FOCUS}`;
export const SECONDARY = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-lg font-medium hover:bg-muted ${FOCUS}`;

/** Heads-up row: white, 4px amber left rule, icon + word (never color alone). */
export function HeadsUpRow({ children, word = "Heads up" }: { children: ReactNode; word?: string }) {
  return (
    <li className="border-l-4 border-amber-600 py-2 pl-4 dark:border-amber-400">
      <p className="flex items-center gap-1.5 font-semibold">
        <TriangleAlert className="size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        {word}
      </p>
      <div className="mt-0.5 space-y-1">{children}</div>
    </li>
  );
}

/** Link that writes the X1 profile handoff first when it points at /coordinate. */
export function GoLink({ href, coordinate, onGo, className, children }: { href: string; coordinate: boolean; onGo: () => void; className: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={coordinate ? onGo : undefined} onAuxClick={coordinate ? onGo : undefined}>
      {children}
    </Link>
  );
}

/** Collapsed disclosure (checkbox type). Native <details>: keyboard and screen-reader friendly. */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group border-t pt-2">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-medium [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="max-w-[65ch] space-y-2 pb-2 pl-5">{children}</div>
    </details>
  );
}
