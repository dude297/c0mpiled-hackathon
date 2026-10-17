"use client";

// U4 Calendar (docs/product/SCREENS.md). Week grid at ≥ 1024px, day list below; each outing links to U5 with its status.
import { useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { SLOTS, placeOnWeek, weekSummary, type Day } from "@/components/calendar/WeekCalendar";
import { FOCUS } from "@/components/shell/focus";
import { PlanStatusLabel } from "@/components/shell/PlanStatusLabel";
import { ProfileGate } from "@/components/shell/ProfileGate";
import { possessive } from "@/components/care/care-model";
import { personLabel, useDeviceStore, usePlanStatus, type PlanStatusApi } from "@/components/shell/store";
import type { PlanItem } from "@/lib/schema";
import { AnalyzeLine, QUIET_LINK, SECONDARY_BTN, SampleNote } from "./bits";
import { DAY_NAMES, SLOT_WORDS, dayOf, dayRows, travelPlain, weekItems } from "./format";

type ViewChoice = "week" | "day";
const VIEW_KEY = "daybridge:ui:calendar-view"; // per-device convenience only

function readView(): ViewChoice {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "day" ? "day" : "week";
  } catch {
    return "week";
  }
}

export function CalendarView() {
  const s = useDeviceStore();
  const title = s.ready && s.mode === "caregiver" && s.profile ? `${possessive(personLabel(s))} week` : "Your week";
  return (
    <div className="space-y-6">
      <h1 className="text-[2.25rem] font-semibold leading-tight">{title}</h1>
      <ProfileGate>
        <Calendar />
      </ProfileGate>
    </div>
  );
}

function Calendar() {
  const { result, week } = useDeviceStore();
  const ps = usePlanStatus();
  // Rendered only after the store is ready (client only), so browser values are safe to read here.
  const [view, setView] = useState<ViewChoice>(readView);
  const [today] = useState<Day>(() => dayOf(new Date()));
  const choose = (v: ViewChoice) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  if (!result) return <AnalyzeLine />;
  const items = weekItems(result, week);

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <SampleNote />
        <p className="text-xl font-semibold">Nothing in your week yet.</p>
        <Link href="/matches" className={QUIET_LINK}>See matches</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">This week · {weekSummary(items)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="hidden items-center gap-1 rounded-xl border p-1 lg:flex">
            <legend className="sr-only">Show as</legend>
            {(["week", "day"] as const).map((v) => (
              <label
                key={v}
                className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg px-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground ${
                  view === v ? "bg-muted font-semibold" : "text-foreground/80 hover:bg-muted"
                }`}
              >
                <input type="radio" name="calendar-view" value={v} checked={view === v} onChange={() => choose(v)} className="sr-only" />
                {v === "week" ? "Week" : "Day list"}
              </label>
            ))}
          </fieldset>
          <button type="button" onClick={() => window.print()} className={SECONDARY_BTN}>
            <Printer className="size-5" aria-hidden="true" />
            Print my week
          </button>
        </div>
      </div>
      <div className="space-y-1">
        <SampleNote />
        <AnalyzeLine />
        {ps.unavailable && <p className="text-base text-muted-foreground">Live status isn&apos;t available on this server.</p>}
      </div>
      </div>

      {view === "week" && <WeekGrid items={items} today={today} ps={ps} />}
      <DayList items={items} today={today} ps={ps} className={view === "week" ? "lg:hidden print:hidden" : "print:hidden"} />
      {/* Paper copy: every day, plain rows (screen grid and controls are hidden). */}
      <DayList items={items} today={today} ps={ps} allDays printOnly className="hidden print:block" />
    </div>
  );
}

function Outing({ item, ps, compact }: { item: PlanItem; ps: PlanStatusApi; compact?: boolean }) {
  return (
    <Link
      href={`/activity/${encodeURIComponent(item.activityId)}?from=calendar`}
      className={`block rounded-xl border ${compact ? "p-2 xl:p-3" : "p-3"} hover:bg-muted/60 ${FOCUS} break-inside-avoid`}
    >
      {/* Wrap only between words: names never break mid-word. */}
      <span className={`block font-semibold leading-snug [overflow-wrap:normal] [word-break:normal] ${compact ? "text-base xl:text-lg" : "text-xl"}`}>{item.name}</span>
      {!ps.unavailable && <PlanStatusLabel view={ps.viewFor(item.activityId)} className="mt-1 text-base" />}
      <span className="mt-0.5 block text-base text-foreground/75">{compact ? travelPlain(item.travel).mode : travelPlain(item.travel).text}</span>
    </Link>
  );
}

function WeekGrid({ items, today, ps }: { items: PlanItem[]; today: Day; ps: PlanStatusApi }) {
  const { days, unscheduled } = placeOnWeek(items);
  return (
    <div className="hidden lg:block print:hidden">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Your week: outings by day and time of day</caption>
        <thead>
          <tr>
            <td className="w-24 xl:w-28" />
            {days.map((d) => (
              <th key={d.day} scope="col" className="px-1 pb-2 text-left align-bottom text-base font-semibold">
                <abbr title={DAY_NAMES[d.day]} className="no-underline">{d.day}</abbr>
                {d.day === today && <span className="block text-base font-normal text-primary">Today</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot, si) => (
            <tr key={slot} className="border-t">
              <th scope="row" className="py-2 pr-2 text-left align-top text-base font-medium text-foreground/80">{SLOT_WORDS[slot]}</th>
              {days.map((d) => {
                const here = d.slots[si].items;
                return (
                  <td key={d.day} className={`h-24 px-1 py-2 align-top`}>
                    {here.length ? (
                      <div className="flex flex-col gap-2">
                        {here.map((i) => <Outing key={i.activityId} item={i} ps={ps} compact />)}
                      </div>
                    ) : (
                      <span className="sr-only">Nothing planned</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {unscheduled.length > 0 && <Unscheduled items={unscheduled} ps={ps} />}
    </div>
  );
}

function DayList({ items, today, ps, allDays, printOnly, className }: {
  items: PlanItem[]; today: Day; ps: PlanStatusApi; allDays?: boolean; printOnly?: boolean; className: string;
}) {
  const { rows, unscheduled } = dayRows(items, today, allDays);
  return (
    <div className={className}>
      <ol className="divide-y border-y">
        {rows.map((r) => (
          <li key={r.day} className="break-inside-avoid py-4">
            <h2 className="text-[1.375rem] font-semibold">
              {DAY_NAMES[r.day]}
              {r.isToday && !printOnly && <span className="font-normal text-primary"> · Today</span>}
            </h2>
            {r.outings.length === 0 ? (
              <p className="mt-1 text-foreground/75">Nothing planned</p>
            ) : (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {r.outings.map(({ slot, item }) => (
                  <li key={item.activityId}>
                    <p className="mb-1 text-base text-foreground/75">{SLOT_WORDS[slot]}</p>
                    {printOnly ? <PrintOuting item={item} ps={ps} /> : <Outing item={item} ps={ps} />}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {unscheduled.length > 0 && <Unscheduled items={unscheduled} ps={ps} />}
    </div>
  );
}

function PrintOuting({ item, ps }: { item: PlanItem; ps: PlanStatusApi }) {
  return (
    <div>
      <p className="font-semibold">{item.name}</p>
      <p>{travelPlain(item.travel).text}</p>
      {!ps.unavailable && <PlanStatusLabel view={ps.viewFor(item.activityId)} />}
    </div>
  );
}

function Unscheduled({ items, ps }: { items: PlanItem[]; ps: PlanStatusApi }) {
  return (
    <section className="mt-4">
      <h2 className="text-[1.375rem] font-semibold">Time to be confirmed</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.activityId}><Outing item={i} ps={ps} /></li>
        ))}
      </ul>
    </section>
  );
}

