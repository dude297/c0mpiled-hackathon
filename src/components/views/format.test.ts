import { describe, expect, it } from "vitest";
import type { AnalysisResult, Barrier, PlanItem, Profile } from "@/lib/schema";
import {
  cardHeadsUp, cleanName, costPlain, dayOf, dayRows, didntFitLabel, didntFitReason, draftProblem, headsUpText, metaLine,
  profileRows, sortMatches, travelPlain, weekItems,
} from "./format";

const soft = (rule: string, detail: string, mitigation?: string): Barrier => ({ rule, severity: "soft", detail, mitigation });
const hard = (rule: string, detail: string): Barrier => ({ rule, severity: "hard", detail });
const item = (activityId: string, when: string, barriers: Barrier[] = [], cost = 0): PlanItem => ({
  activityId, name: activityId, when, travel: "bus, 15 min", costPerWeek: cost, score: 1, barriers,
});

describe("plain words", () => {
  it("cost", () => {
    expect(costPlain(0)).toBe("Free");
    expect(costPlain(5)).toBe("$5 a week");
  });
  it("travel", () => {
    expect(travelPlain("bus, 15 min")).toEqual({ mode: "Bus", text: "Bus, about 15 min" });
    expect(travelPlain("paratransit, 30 min").text).toBe("Senior shuttle, about 30 min");
    expect(travelPlain("odd").text).toBe("Odd");
  });
  it("meta line, no chips", () => expect(metaLine(item("a", "Wed afternoon", [], 5))).toBe("Wed afternoon · Bus, about 15 min · $5 a week"));
  it("heads-up text", () => {
    expect(headsUpText(soft("transport", "Paratransit, 30 min", "Book the ride 24 hours ahead"))).toEqual({
      detail: "Senior shuttle, about 30 min", tip: "Book the ride 24 hours ahead",
    });
    expect(headsUpText(soft("social", "Large group; prefers small groups")).detail).toBe("Large group");
  });
});

describe("cardHeadsUp", () => {
  it("first soft barrier only, counts the rest", () => {
    const i = item("a", "Mon morning", [hard("x", "h"), soft("a", "one"), soft("b", "two"), soft("c", "three")]);
    expect(cardHeadsUp(i).first?.detail).toBe("one");
    expect(cardHeadsUp(i).more).toBe(2);
  });
  it("none", () => expect(cardHeadsUp(item("a", "Mon morning"))).toEqual({ first: null, more: 0 }));
});

describe("didntFitReason", () => {
  it("too far", () => expect(didntFitReason([hard("transport", "Fastest option is bus at 45 min; limit is 30 min")])).toBe("Too far: 45 min, your limit is 30"));
  it("no route", () => expect(didntFitReason([hard("transport", "No way to get there using bus/family")])).toBe("No way to get there by bus or family ride"));
  it("time", () => expect(didntFitReason([hard("time", "Meets Thu evening; Margaret is only available morning/afternoon")])).toBe("Meets Thu evening, outside the times you picked"));
  it("stairs", () => expect(didntFitReason([hard("access", "Entrance has stairs; Margaret uses a walker")])).toBe("Entrance has stairs, no step-free way in"));
  it("cost", () => expect(didntFitReason([hard("cost", "$15/week exceeds the $10 budget")])).toBe("Costs $15 a week, over the $10 budget"));
  it("first hard one wins, soft ignored", () => expect(didntFitReason([soft("s", "soft"), hard("x", "Something else")])).toBe("Something else"));
  it("count label", () => {
    expect(didntFitLabel(1)).toBe("1 activity didn't fit — see why");
    expect(didntFitLabel(6)).toBe("6 activities didn't fit — see why");
  });
});

describe("week", () => {
  const plan = [item("a", "Mon morning"), item("b", "Wed afternoon"), item("c", "Fri evening")];
  const result = { plan } as AnalysisResult;
  it("sortMatches puts not-in-week first, stable", () => expect(sortMatches(plan, ["a"]).map((i) => i.activityId)).toEqual(["b", "c", "a"]));
  it("weekItems ignores unknown ids", () => expect(weekItems(result, ["c", "zzz", "a"]).map((i) => i.activityId)).toEqual(["a", "c"]));
  it("weekItems without a result", () => expect(weekItems(null, ["a"])).toEqual([]));
  it("dayOf maps Sunday", () => {
    expect(dayOf(new Date(2026, 9, 18))).toBe("Sun");
    expect(dayOf(new Date(2026, 9, 19))).toBe("Mon");
  });
  it("dayRows keeps days with outings plus today", () => {
    const { rows } = dayRows(weekItems(result, ["a", "c"]), "Tue");
    expect(rows.map((r) => [r.day, r.isToday, r.outings.length])).toEqual([["Mon", false, 1], ["Tue", true, 0], ["Fri", false, 1]]);
  });
  it("dayRows allDays keeps all seven; unparseable when is unscheduled", () => {
    const { rows, unscheduled } = dayRows([item("x", "sometime")], "Mon", true);
    expect(rows).toHaveLength(7);
    expect(unscheduled.map((i) => i.activityId)).toEqual(["x"]);
  });
});

describe("profile rows", () => {
  const p: Profile = {
    name: "Margaret", interests: ["music", "cards"], mobility: "walker", transport: ["bus", "family"], maxTravelMin: 30,
    times: ["morning", "afternoon"], budgetPerWeek: 20, hearingImpaired: true, prefersSmallGroups: false,
  };
  it("plain words, review labels", () => {
    const rows = Object.fromEntries(profileRows(p).map((r) => [r.field, r.value]));
    expect(rows.interests).toBe("Music & singing, Cards & games");
    expect(rows.mobility).toBe("A walker");
    expect(rows.transport).toBe("Bus or train, Family or friends drive me");
    expect(rows.maxTravelMin).toBe("Across town is fine (about 30 minutes)");
    expect(rows.budgetPerWeek).toBe("Up to $20 a week");
    expect(rows.hearingImpaired).toBe("Yes, hard of hearing");
  });
  it("optional rows are hearing + small groups", () =>
    expect(profileRows(p).filter((r) => r.optional).map((r) => r.field)).toEqual(["hearingImpaired", "prefersSmallGroups"]));
  it("draftProblem blocks empty multi-picks", () => {
    expect(draftProblem(p)).toBeNull();
    expect(draftProblem({ ...p, transport: [] })).toMatch(/way you get places/);
  });
  it("blank name → Friend", () => expect(cleanName("  ")).toBe("Friend"));
});
