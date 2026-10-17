import { describe, expect, it } from "vitest";
import { costLabel, hardBarriers, softBarriers, toggleInSet, toggleMessage } from "@/components/feed/MatchFeed";
import type { Barrier, PlanItem } from "@/lib/schema";

const soft: Barrier = { rule: "noise", severity: "soft", detail: "Can be loud", mitigation: "Sit near the front" };
const hard: Barrier = { rule: "steps", severity: "hard", detail: "Stairs only" };

const item: PlanItem = { activityId: "choir", name: "Choir", when: "Tue afternoon", travel: "bus, 25 min", costPerWeek: 0, score: 1, barriers: [soft, hard] };

describe("costLabel", () => {
  it("says Free for zero cost", () => expect(costLabel(0)).toBe("Free"));
  it("formats weekly cost", () => expect(costLabel(5)).toBe("$5/week"));
  it("shows cents for non-whole amounts", () => expect(costLabel(2.5)).toBe("$2.50/week"));
});

describe("barrier filters", () => {
  it("softBarriers keeps only soft ones", () => expect(softBarriers(item)).toEqual([soft]));
  it("hardBarriers keeps only hard ones", () => expect(hardBarriers(item.barriers)).toEqual([hard]));
});

describe("toggleInSet", () => {
  it("adds a missing id without mutating the input", () => {
    const start = new Set(["a"]);
    const next = toggleInSet(start, "b");
    expect([...next].sort()).toEqual(["a", "b"]);
    expect([...start]).toEqual(["a"]);
  });
  it("removes an existing id", () => expect([...toggleInSet(new Set(["a", "b"]), "a")]).toEqual(["b"]));
});

describe("toggleMessage", () => {
  it("names the day when added", () => expect(toggleMessage({ name: "Library Cards", when: "Wed afternoon" }, true)).toBe("Added Library Cards to Wednesday"));
  it("names the day when removed", () => expect(toggleMessage({ name: "Choir", when: "tuesday Morning" }, false)).toBe("Removed Choir from Tuesday"));
  it("falls back to 'your week' for an unparseable time", () => expect(toggleMessage({ name: "Choir", when: "TBD" }, true)).toBe("Added Choir to your week"));
});
