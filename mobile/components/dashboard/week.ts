// Ported from web src/components/calendar/WeekCalendar.tsx (a DOM/lucide file, not importable here).
// Same parsing + grouping — keep in sync. Pure, no React.
import type { PlanItem } from '@/lib/schema';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type Day = (typeof DAYS)[number];
export type Slot = (typeof SLOTS)[number];

export const DAY_NAMES: Record<Day, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
};
export const SLOT_LABELS: Record<Slot, { emoji: string; label: string }> = {
  morning: { emoji: '🌅', label: 'Morning' },
  afternoon: { emoji: '☀️', label: 'Afternoon' },
  evening: { emoji: '🌆', label: 'Evening' },
};

export type WeekDay = { day: Day; slots: { slot: Slot; items: PlanItem[] }[]; count: number };
export type PlacedWeek = { days: WeekDay[]; unscheduled: PlanItem[] };

/** Parses "Tue afternoon" (also "tuesday Afternoon") → { day, slot }, or null if it can't. */
export function parseWhen(when: string): { day: Day; slot: Slot } | null {
  const m = /^\s*([a-z]{3})[a-z]*\s+(morning|afternoon|evening)\s*$/i.exec(when ?? '');
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

export const costLabel = (n: number) => (n === 0 ? 'Free' : `$${Number.isInteger(n) ? n : n.toFixed(2)}/week`);
export const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
