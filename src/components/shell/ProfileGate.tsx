"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FOCUS } from "./focus";
import { useDeviceStore } from "./store";

/**
 * Renders children only once the active person has saved answers.
 * Before storage is read: nothing (no full-page loader). No answers at all: a friendly "Start here" to "/".
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const { ready, profile } = useDeviceStore();
  if (!ready) return null;
  if (!profile) return <StartHere />;
  return <>{children}</>;
}

export function StartHere() {
  return (
    <section className="max-w-[65ch] space-y-3 py-6 text-lg">
      <h2 className="text-[1.75rem] font-semibold leading-tight">Let&apos;s get to know you first</h2>
      <p>Answer a few short questions and we&apos;ll find activities you can actually get to.</p>
      <p className="text-base text-muted-foreground">Or open the person menu above to look around with a sample person.</p>
      <Link
        href="/"
        className={`inline-flex min-h-14 items-center rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground hover:bg-primary/85 ${FOCUS}`}
      >
        Start here
      </Link>
    </section>
  );
}
