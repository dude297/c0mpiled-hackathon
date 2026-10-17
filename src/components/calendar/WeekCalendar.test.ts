import { describe, expect, it } from "vitest";
import { parseWhen, placeOnWeek } from "@/components/calendar/WeekCalendar";
import type { PlanItem } from "@/lib/schema";

const item = (activityId: string, when: string): PlanItem => ({
  activityId, name: activityId, when, travel: "bus, 15 min", costPerWeek: 2, score: 1, barriers: [],
});
const ids = (xs: PlanItem[]) => xs.map((x) => x.activityId);

describe("parseWhen", () => {
  it("parses the engine format", () => {
    expect(parseWhen("Tue afternoon")).toEqual({ day: "Tue", slot: "afternoon" });
    expect(parseWhen("Sun evening")).toEqual({ day: "Sun", slot: "evening" });
  });
  it("tolerates case, full day names and extra spaces", () => {
    expect(parseWhen("  wednesday   Morning ")).toEqual({ day: "Wed", slot: "morning" });
  });
  it("returns null for anything else", () => {
    for (const bad of ["", "Tue", "afternoon", "Tue noon", "Xyz morning", "Tue afternoon 3pm", "Tu morning"]) {
      expect(parseWhen(bad)).toBeNull();
    }
  });
});

describe("placeOnWeek", () => {
  it("always returns Mon→Sun with morning→evening slots", () => {
    const w = placeOnWeek([]);
    expect(w.days.map((d) => d.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(w.days[0].slots.map((s) => s.slot)).toEqual(["morning", "afternoon", "evening"]);
    expect(w.days.every((d) => d.count === 0)).toBe(true);
    expect(w.unscheduled).toEqual([]);
  });

  it("places items by day and slot regardless of input order", () => {
    const w = placeOnWeek([item("c", "Sun evening"), item("a", "Mon morning"), item("b", "Thu afternoon")]);
    expect(ids(w.days[0].slots[0].items)).toEqual(["a"]);
    expect(ids(w.days[3].slots[1].items)).toEqual(["b"]);
    expect(ids(w.days[6].slots[2].items)).toEqual(["c"]);
    expect(w.days.map((d) => d.count)).toEqual([1, 0, 0, 1, 0, 0, 1]);
  });

  it("keeps multiple items in one slot, in input order", () => {
    const w = placeOnWeek([item("x", "Wed morning"), item("y", "Wed morning"), item("z", "Wed evening")]);
    expect(ids(w.days[2].slots[0].items)).toEqual(["x", "y"]);
    expect(ids(w.days[2].slots[2].items)).toEqual(["z"]);
    expect(w.days[2].count).toBe(3);
  });

  it("puts unparseable items in unscheduled instead of crashing", () => {
    const w = placeOnWeek([item("ok", "Fri afternoon"), item("bad", "sometime"), item("empty", "")]);
    expect(ids(w.unscheduled)).toEqual(["bad", "empty"]);
    expect(ids(w.days[4].slots[1].items)).toEqual(["ok"]);
    expect(w.days.reduce((n, d) => n + d.count, 0)).toBe(1);
  });
});
