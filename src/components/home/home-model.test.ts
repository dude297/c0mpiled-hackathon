import { describe, expect, it } from "vitest";
import { NOT_STARTED, planStatusView, type PlanStatus } from "@/components/shell/helpers";
import type { AnalysisResult, PlanItem, PlanState } from "@/lib/schema";
import {
  activityPrimaryLabel, attentionRows, backLink, checksFor, costWords, didntFitReason, greeting, homePrimary, nextOuting, noMatchReason,
  otherWays, softBarrierText, todayIndex, travelLine, weekItems, weekLine, weekStrip,
} from "./home-model";

const item = (activityId: string, when: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  activityId, name: activityId[0].toUpperCase() + activityId.slice(1), when, travel: "bus, 15 min", costPerWeek: 0, score: 1, barriers: [], ...extra,
});

const result = (plan: PlanItem[], extra: Partial<AnalysisResult> = {}): AnalysisResult => ({
  summary: "", items: [], plan, blocked: [], evidence: [], explanation: "", dataSource: "mock", ...extra,
});

const statuses = (map: Record<string, PlanState>) => (id: string): PlanStatus =>
  map[id] ? { state: map[id], planId: `p-${id}`, plan: null } : NOT_STARTED;
const views = (map: Record<string, PlanState>) => (id: string) => planStatusView(map[id] ?? null);

const choir = item("choir", "Tue afternoon");
const cards = item("cards", "Wed afternoon", { costPerWeek: 5 });
const garden = item("garden", "Sat morning", { costPerWeek: 0.5 });

describe("week lines", () => {
  it("summarises outings and cost", () => {
    expect(weekLine([])).toBe("Nothing in your week yet");
    expect(weekLine([choir])).toBe("1 outing · Free");
    expect(weekLine([choir, cards])).toBe("2 outings · $5 this week");
    expect(weekLine([cards, garden])).toBe("2 outings · $5.50 this week");
  });
  it("words the cost for U5", () => {
    expect(costWords(0)).toBe("Free");
    expect(costWords(12)).toBe("$12 a week");
  });
  it("turns engine travel into plain words", () => {
    expect(travelLine("bus, 15 min")).toBe("Bus, about 15 min");
    expect(travelLine("paratransit, 30 min")).toBe("Senior shuttle, about 30 min");
    expect(travelLine("somehow")).toBe("somehow");
  });
  it("lists other ways, never walking for a walker user", () => {
    const a = { travelMin: { drive: 6, bus: 15, walk: 20 } };
    expect(otherWays(a, "bus", "full")).toEqual(["driving, about 6 min", "walking, about 20 min"]);
    expect(otherWays(a, "bus", "walker")).toEqual(["driving, about 6 min"]);
  });
});

describe("week order and next outing", () => {
  it("keeps only week ids, Monday first", () => {
    expect(weekItems(result([garden, cards, choir]), ["garden", "choir"]).map((i) => i.activityId)).toEqual(["choir", "garden"]);
    expect(weekItems(null, ["choir"])).toEqual([]);
  });
  it("picks the next outing from today and wraps around", () => {
    const items = [choir, cards, garden];
    expect(nextOuting(items, 0)?.activityId).toBe("choir"); // Monday
    expect(nextOuting(items, 2)?.activityId).toBe("cards"); // Wednesday counts today
    expect(nextOuting(items, 6)?.activityId).toBe("choir"); // Sunday wraps
    expect(nextOuting([], 3)).toBeNull();
  });
  it("wraps to Monday instead of picking a time-TBD outing", () => {
    const tbd = item("tbd", "time TBD");
    expect(nextOuting([choir, tbd], 6)?.activityId).toBe("choir");
    expect(nextOuting([tbd], 3)?.activityId).toBe("tbd");
  });
  it("Monday is day 0", () => {
    expect(todayIndex(new Date(2026, 9, 19))).toBe(0); // Mon 19 Oct 2026
    expect(todayIndex(new Date(2026, 9, 18))).toBe(6); // Sun
  });
  it("builds a 7-day strip with today marked", () => {
    const s = weekStrip([choir], 1);
    expect(s).toHaveLength(7);
    expect(s[1]).toMatchObject({ day: "Tue", today: true });
    expect(s[1].items).toEqual([choir]);
    expect(s[0].items).toEqual([]);
  });
  it("greets by time of day", () => {
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });
});

describe("homePrimary (first matching row wins)", () => {
  const items = [choir, cards];
  it("empty week → See matches", () => {
    expect(homePrimary([], null, statuses({}), false)).toMatchObject({ label: "See matches", href: "/matches" });
  });
  it("NEEDS_REPLAN anywhere beats everything and resumes that plan", () => {
    const p = homePrimary(items, choir, statuses({ choir: "BLOCKED", cards: "NEEDS_REPLAN" }), false);
    expect(p).toEqual({ label: "Fix my plan", href: "/coordinate?activityId=cards&planId=p-cards", coordinate: true });
  });
  it("BLOCKED next", () => {
    expect(homePrimary(items, choir, statuses({ cards: "BLOCKED" }), false).label).toBe("See what's in the way");
  });
  it("next outing in progress → Continue / See status", () => {
    expect(homePrimary(items, choir, statuses({ choir: "AWAITING_APPROVAL" }), false).label).toBe("Continue my plan");
    expect(homePrimary(items, choir, statuses({ choir: "PROPOSED" }), false).label).toBe("Continue my plan");
    expect(homePrimary(items, choir, statuses({ choir: "PENDING_CONFIRMATION" }), false).href).toBe("/coordinate?activityId=choir&planId=p-choir");
  });
  it("Not started → Get me there, a new plan (golden path)", () => {
    expect(homePrimary(items, choir, statuses({}), false)).toEqual({ label: "Get me there", href: "/coordinate?activityId=choir", coordinate: true });
  });
  it("Ready → See my calendar", () => {
    expect(homePrimary(items, choir, statuses({ choir: "READY" }), false)).toMatchObject({ label: "See my calendar", href: "/calendar" });
  });
  it("503 never leaves a dead Get me there", () => {
    expect(homePrimary(items, choir, statuses({}), true)).toMatchObject({ label: "See my calendar", coordinate: false });
  });
});

describe("attentionRows", () => {
  const soft = { rule: "hearing", severity: "soft" as const, detail: "Noisy room, no hearing loop", mitigation: "Sit near the leader." };
  it("orders by urgency, then dropped, then one soft barrier, max 3", () => {
    const map = { choir: "AWAITING_APPROVAL", cards: "NEEDS_REPLAN" } as const;
    const rows = attentionRows({
      items: [{ ...choir, barriers: [soft] }, cards, { ...garden, barriers: [soft] }],
      statusFor: statuses(map),
      viewFor: views(map),
      dropped: [{ activityId: "quilting", name: "Sewing", reason: "Entrance has stairs; Margaret uses a walker" }],
      unavailable: false,
    });
    expect(rows.map((r) => r.text)).toEqual([
      "Cards on Wednesday: needs a new plan.",
      "Choir on Tuesday: needs your OK.",
      "Sewing no longer fits: entrance has stairs; Margaret uses a walker.",
    ]);
    expect(rows[0].link).toEqual({ label: "Fix my plan", href: "/coordinate?activityId=cards&planId=p-cards", coordinate: true });
  });
  it("shows one soft barrier with what helps", () => {
    const rows = attentionRows({ items: [{ ...choir, barriers: [soft] }, { ...garden, barriers: [soft] }], statusFor: statuses({}), viewFor: views({}), dropped: [], unavailable: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Choir: noisy room, no hearing loop. Sit near the leader.");
    expect(rows[0].link.href).toBe("/activity/choir?from=home");
  });
  it("words a travel barrier the same way Matches does", () => {
    const ride = { rule: "transport", severity: "soft" as const, detail: "paratransit, 30 min." };
    const rows = attentionRows({ items: [{ ...choir, barriers: [ride] }], statusFor: statuses({}), viewFor: views({}), dropped: [], unavailable: false });
    expect(rows[0].text).toBe("Choir: senior shuttle, about 30 min.");
    expect(softBarrierText({ rule: "social", detail: "large group; prefers small groups" })).toEqual({ detail: "Large group", tip: null });
  });
  it("hides status rows when live status is unavailable", () => {
    const map = { choir: "NEEDS_REPLAN" } as const;
    expect(attentionRows({ items: [choir], statusFor: statuses(map), viewFor: views(map), dropped: [], unavailable: true })).toEqual([]);
  });
});

describe("U5 helpers", () => {
  const r = result([choir], {
    evidence: [
      { claim: "Choir: Step-free entrance", source: "activity:choir/rule:access", verified: true },
      { claim: "Bridge: Entrance has stairs", source: "activity:bridge/rule:access", verified: false },
    ],
    blocked: [
      { name: "Bridge", barriers: [{ rule: "access", severity: "hard", detail: "Entrance has stairs; Margaret uses a walker" }] },
      { name: "Far", barriers: [{ rule: "transport", severity: "hard", detail: "Too far" }] },
      { name: "Farther", barriers: [{ rule: "transport", severity: "hard", detail: "Too far" }] },
    ],
  });
  it("reads checks for one activity without its name prefix", () => {
    expect(checksFor(r, "Choir")).toEqual([{ text: "Step-free entrance", passed: true }]);
    expect(checksFor(null, "Choir")).toEqual([]);
  });
  it("finds the first hard reason and the most common one", () => {
    expect(didntFitReason(r, "Bridge")).toBe("Entrance has stairs; Margaret uses a walker");
    expect(didntFitReason(r, "Choir")).toBeNull();
    expect(noMatchReason(r)).toBe("Nothing fits yet: most were too far.");
    expect(noMatchReason(result([]))).toBe("Nothing fits yet.");
  });
  it("goes back where the person came from", () => {
    expect(backLink("calendar", "user")).toEqual({ label: "Back to calendar", href: "/calendar" });
    expect(backLink(null, "user").href).toBe("/matches");
    expect(backLink("nonsense", "caregiver").href).toBe("/care");
    for (const key of ["toString", "__proto__", "constructor", "hasOwnProperty"]) expect(backLink(key, "user")).toEqual({ label: "Back to matches", href: "/matches" });
  });
  it("words the primary by mode", () => {
    expect(activityPrimaryLabel(planStatusView(null), "user", "Margaret")).toBe("Get me there");
    expect(activityPrimaryLabel(planStatusView(null, "caregiver"), "caregiver", "Margaret")).toBe("Get them there");
    expect(activityPrimaryLabel(planStatusView("NEEDS_REPLAN", "caregiver"), "caregiver", "Margaret")).toBe("Open with Margaret");
    expect(activityPrimaryLabel(planStatusView("COMPLETED"), "user", "Margaret")).toBeNull();
  });
});
