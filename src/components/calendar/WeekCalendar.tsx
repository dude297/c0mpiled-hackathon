import { CalendarHeart, MapPin, TriangleAlert } from "lucide-react";
import { costLabel } from "@/components/feed/MatchFeed";
import type { PlanItem } from "@/lib/schema";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const SLOTS = ["morning", "afternoon", "evening"] as const;
export type Day = (typeof DAYS)[number];
export type Slot = (typeof SLOTS)[number];

const DAY_NAMES: Record<Day, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
const SLOT_LABELS: Record<Slot, { emoji: string; label: string }> = {
  morning: { emoji: "🌅", label: "Morning" },
  afternoon: { emoji: "☀️", label: "Afternoon" },
  evening: { emoji: "🌆", label: "Evening" },
};

export type WeekDay = { day: Day; slots: { slot: Slot; items: PlanItem[] }[]; count: number };
export type PlacedWeek = { days: WeekDay[]; unscheduled: PlanItem[] };

/** Parses "Tue afternoon" (also "tuesday Afternoon") → { day, slot }, or null if it can't. */
export function parseWhen(when: string): { day: Day; slot: Slot } | null {
  const m = /^\s*([a-z]{3})[a-z]*\s+(morning|afternoon|evening)\s*$/i.exec(when ?? "");
  if (!m) return null;
  const day = DAYS.find((d) => d.toLowerCase() === m[1].toLowerCase());
  return day ? { day, slot: m[2].toLowerCase() as Slot } : null;
}

/** Groups items Mon→Sun, morning→evening. Unparseable `when` goes to `unscheduled`. */
export function placeOnWeek(items: PlanItem[]): PlacedWeek {
  const days: WeekDay[] = DAYS.map((day) => ({ day, slots: SLOTS.map((slot) => ({ slot, items: [] as PlanItem[] })), count: 0 }));
  const unscheduled: PlanItem[] = [];
  for (const item of items) {
    const at = parseWhen(item.when);
    if (!at) {
      unscheduled.push(item);
      continue;
    }
    const d = days[DAYS.indexOf(at.day)];
    d.slots[SLOTS.indexOf(at.slot)].items.push(item);
    d.count++;
  }
  return { days, unscheduled };
}

/** "2 outings · $5/week", "1 outing · Free", or "Nothing added yet" — same cost rule as the match cards. */
export function weekSummary(items: PlanItem[]): string {
  if (items.length === 0) return "Nothing added yet";
  const total = items.reduce((sum, i) => sum + i.costPerWeek, 0);
  return `${items.length} ${items.length === 1 ? "outing" : "outings"} · ${costLabel(total)}`;
}

function Activity({ item, compact }: { item: PlanItem; compact?: boolean }) {
  const soft = item.barriers.filter((b) => b.severity === "soft");
  const small = compact ? "text-sm" : "text-base";
  return (
    <div className="min-w-0 break-inside-avoid rounded-xl border bg-card p-2.5 shadow-sm md:p-2">
      <p className={`min-w-0 font-semibold leading-snug break-words ${compact ? "text-sm md:text-base" : "text-lg"}`}>{item.name}</p>
      <p className={`mt-1 flex items-start gap-1 text-muted-foreground ${small}`}>
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.travel}</span>
      </p>
      <p className={small}>
        <b>{costLabel(item.costPerWeek)}</b>
      </p>
      {soft.map((b) => (
        <p key={b.rule} className={`mt-1.5 rounded-md bg-amber-100 p-1.5 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 ${small}`}>
          <span className="flex items-center gap-1 font-semibold">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            Heads up:
          </span>
          {b.mitigation ?? b.detail}
        </p>
      ))}
    </div>
  );
}

export function WeekCalendar({ items }: { items: PlanItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed p-8 text-center text-base md:text-lg" role="status">
        <CalendarHeart className="mx-auto mb-2 size-8 text-primary" aria-hidden="true" />
        <p className="text-lg font-semibold md:text-xl">Your week is open</p>
        <p className="mt-1 text-muted-foreground">Tap “❤️ Add to my week” on a match and it will show up here.</p>
      </div>
    );
  }

  const { days, unscheduled } = placeOnWeek(items);

  return (
    <section aria-label="My week" className="text-base md:text-lg">
      {/* Desktop + print: Mon–Sun grid */}
      <table className="hidden w-full table-fixed border-separate border-spacing-1 md:table print:table">
        <caption className="sr-only">My week: activities by day and time of day</caption>
        <thead>
          <tr>
            <td className="w-16" />
            {days.map((d) => (
              <th key={d.day} scope="col" className="pb-1 text-center text-base font-semibold">
                <abbr title={DAY_NAMES[d.day]} className="no-underline">{d.day}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot, si) => (
            <tr key={slot}>
              <th scope="row" className="pr-1 text-left align-top text-xs font-semibold break-words">
                <span aria-hidden="true" className="block text-xl">{SLOT_LABELS[slot].emoji}</span>
                {SLOT_LABELS[slot].label}
              </th>
              {days.map((d) => {
                const here = d.slots[si].items;
                return (
                  <td key={d.day} className={`h-20 rounded-lg align-top ${here.length ? "" : "bg-muted/30"}`}>
                    {here.length ? (
                      <div className="flex flex-col gap-1">
                        {here.map((i) => <Activity key={i.activityId} item={i} compact />)}
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

      {/* Mobile: one line per day */}
      <ol className="flex flex-col gap-2 md:hidden print:hidden">
        {days.map((d) =>
          d.count === 0 ? (
            <li key={d.day} className="flex items-baseline gap-2 px-1 py-1 text-muted-foreground">
              <span className="w-12 font-semibold text-foreground/70">{d.day}</span>
              <span>Free day</span>
            </li>
          ) : (
            <li key={d.day} className="rounded-xl border bg-muted/20 p-3">
              <h3 className="text-lg font-semibold">{DAY_NAMES[d.day]}</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {d.slots.flatMap((s) =>
                  s.items.map((i) => (
                    <li key={i.activityId}>
                      <p className="mb-1 text-sm font-medium text-muted-foreground">
                        <span aria-hidden="true">{SLOT_LABELS[s.slot].emoji} </span>
                        {SLOT_LABELS[s.slot].label}
                      </p>
                      <Activity item={i} />
                    </li>
                  )),
                )}
              </ul>
            </li>
          ),
        )}
      </ol>

      {unscheduled.length > 0 && (
        <div className="mt-3">
          <h3 className="font-semibold">Time to be confirmed</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {unscheduled.map((i) => (
              <li key={i.activityId}>
                <Activity item={i} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 border-t pt-3 text-center font-medium">
        {weekSummary(items)}
      </p>
    </section>
  );
}
