"use client";

// U2 Home dashboard (docs/product/SCREENS.md "U2"). Reads the device store + plan status; never invents data.
import Link from "next/link";
import { useState } from "react";
import { PlanStatusLabel } from "@/components/shell/PlanStatusLabel";
import { ProfileGate } from "@/components/shell/ProfileGate";
import { FOCUS } from "@/components/shell/focus";
import { personLabel, useDeviceStore, usePlanStatus } from "@/components/shell/store";
import { writeProfileHandoff } from "./handoff";
import {
  activityHref, aiLabel, attentionRows, greeting, homePrimary, nextOuting, noMatchReason, todayIndex, travelLine, weekItems, weekLine, weekStrip,
} from "./home-model";
import { Disclosure, GoLink, HeadsUpRow, PRIMARY, QUIET_LINK, SECONDARY } from "./ui";

export function HomeDashboard() {
  return (
    <ProfileGate>
      <HomeContent />
    </ProfileGate>
  );
}

const H2 = "text-[1.75rem] font-semibold leading-tight";

function HomeContent() {
  const s = useDeviceStore();
  const ps = usePlanStatus();
  // Mounted only after the store is ready (client), so reading the clock here never runs during prerender.
  const [now] = useState(() => new Date());
  const name = personLabel(s);
  const handoff = () => writeProfileHandoff(s.profile);

  const items = weekItems(s.result, s.week);
  const today = todayIndex(now);
  const next = nextOuting(items, today);
  const primary = homePrimary(items, next, ps.statusFor, ps.unavailable);
  const rows = attentionRows({ items, statusFor: ps.statusFor, viewFor: ps.viewFor, dropped: s.dropped, unavailable: ps.unavailable });
  const moreMatches = s.result ? s.result.plan.filter((i) => !s.week.includes(i.activityId)).length : 0;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-[2.25rem] font-semibold leading-tight break-words">
          {greeting(now.getHours())}, {name}
        </h1>
        {s.person !== "me" && <p className="text-[1rem] text-muted-foreground">{name} is a sample person (demo data).</p>}
        {!s.storageOk && <p className="text-[1rem] text-muted-foreground">This browser won&apos;t remember your answers.</p>}
      </header>

      {/* One live region for the inline states: no full-page loader, the rest stays usable. */}
      <div aria-live="polite" className="empty:hidden">
        {s.analyzing && <p className="text-lg">Finding activities you can get to…</p>}
        {!s.analyzing && s.error && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-lg">
            <span>{s.error}</span>
            <button type="button" className={SECONDARY} onClick={() => void s.analyze()}>
              Try again
            </button>
          </p>
        )}
      </div>

      {s.result && s.result.plan.length === 0 && (
        <section aria-labelledby="nothing-heading" className="max-w-[65ch] space-y-3">
          <h2 id="nothing-heading" className={H2}>Your week</h2>
          <p className="text-lg">{noMatchReason(s.result)}</p>
          <Link href="/profile" className={QUIET_LINK}>Change my answers</Link>
          <div className="pt-2">
            <Link href="/matches" className={PRIMARY}>See matches</Link>
          </div>
        </section>
      )}

      {s.result && s.result.plan.length > 0 && (
        // DOM order = phone order (week, next, attention, more); from 1280px attention moves to the right column.
        <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] xl:grid-rows-[auto_1fr]">
          <div className="min-w-0 space-y-8 xl:col-start-1 xl:row-start-1">
            <section aria-labelledby="week-heading" className="space-y-3">
              <h2 id="week-heading" className={H2}>Your week</h2>
              <p className="text-lg">{weekLine(items)}</p>
              <WeekStrip items={items} today={today} />
            </section>

            <section aria-labelledby="next-heading" className="space-y-4">
              <h2 id="next-heading" className={H2}>Next outing</h2>
              {next ? (
                <div className="space-y-1 rounded-xl border p-4 md:p-5">
                  <Link href={activityHref(next.activityId, "home")} className={`rounded-md text-xl font-semibold leading-snug break-words underline-offset-4 hover:underline ${FOCUS}`}>
                    {next.name}
                  </Link>
                  <p className="text-lg text-foreground/80">
                    {next.when} · {travelLine(next.travel)}
                  </p>
                  {ps.unavailable ? (
                    <p className="text-[1rem] text-muted-foreground">Live status and Get me there aren&apos;t available on this server.</p>
                  ) : (
                    <PlanStatusLabel view={ps.viewFor(next.activityId)} className="text-lg" />
                  )}
                </div>
              ) : (
                <p className="text-lg">Pick something from your matches to add it here.</p>
              )}
              <GoLink href={primary.href} coordinate={primary.coordinate} onGo={handoff} className={PRIMARY}>
                {primary.label}
              </GoLink>
            </section>
          </div>

          {rows.length > 0 && (
            <section aria-labelledby="attention-heading" className="min-w-0 space-y-3 xl:col-start-2 xl:row-span-2 xl:row-start-1">
              <h2 id="attention-heading" className={H2}>Needs attention</h2>
              <ul className="space-y-4">
                {rows.map((r) => (
                  <HeadsUpRow key={r.key}>
                    <p className="text-lg break-words">{r.text}</p>
                    {/* The primary button already opens this one; don't repeat it (same rule as Care). */}
                    {r.link.href !== primary.href && (
                      <GoLink href={r.link.href} coordinate={r.link.coordinate} onGo={handoff} className={QUIET_LINK}>
                        {r.link.label}
                      </GoLink>
                    )}
                  </HeadsUpRow>
                ))}
              </ul>
            </section>
          )}

          <div className="min-w-0 space-y-8 xl:col-start-1 xl:row-start-2">
            {moreMatches > 0 && (
              <p className="text-lg">
                <Link href="/matches" className={QUIET_LINK}>
                  {moreMatches} more good {moreMatches === 1 ? "match" : "matches"}
                </Link>
              </p>
            )}

            {s.result.explanation.trim() && (
              <Disclosure summary="Why these?">
                <p className="text-[1rem] text-muted-foreground">{aiLabel(s.result.dataSource)}</p>
                <p className="text-lg whitespace-pre-line">{s.result.explanation}</p>
              </Disclosure>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 7-day strip → Calendar. Dots on outing days; names from 768px up (always read out to screen readers). */
function WeekStrip({ items, today }: { items: ReturnType<typeof weekItems>; today: number }) {
  return (
    <Link href="/calendar" className={`block rounded-xl py-2 hover:bg-muted ${FOCUS}`}>
      <span className="sr-only">Open your calendar. </span>
      <ol className="grid grid-cols-7 gap-1">
        {weekStrip(items, today).map((d) => (
          <li key={d.day} className="min-w-0 px-1 text-center md:text-left">
            <span aria-hidden="true" className={`block text-[1rem] ${d.today ? "font-semibold underline underline-offset-4" : "text-foreground/75"}`}>
              {d.today ? "Today" : d.day}
            </span>
            <span className="sr-only">
              {d.today ? `Today, ${d.name}` : d.name}: {d.items.length ? d.items.map((i) => i.name).join(", ") : "nothing"}.
            </span>
            <span aria-hidden="true" className="mt-1.5 flex h-3 items-center justify-center md:justify-start">
              {d.items.length > 0 && <span className="size-2.5 rounded-full bg-primary" />}
            </span>
            {d.items.map((i) => (
              <span key={i.activityId} aria-hidden="true" className="mt-1 hidden text-[1rem] leading-snug break-words md:line-clamp-2">
                {i.name}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </Link>
  );
}
