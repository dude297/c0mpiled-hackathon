import { describe, expect, it } from "vitest";
import { answersToProfile, swipeDirection, undoAnswer, type Answer } from "@/components/onboarding/CardDeck";
import { Profile, type Profile as ProfileType } from "@/lib/schema";

describe("answersToProfile", () => {
  it("maps liked interests only", () => {
    const profile = answersToProfile(
      [
        { kind: "interest", key: "music", liked: true },
        { kind: "interest", key: "gardening", liked: false },
        { kind: "interest", key: "cards", liked: true },
      ],
      "Margaret",
    );
    expect(profile.interests).toEqual(["music", "cards"]);
    expect(profile.name).toBe("Margaret");
  });

  it("falls back to a safe default when no interests liked", () => {
    const profile = answersToProfile(
      [{ kind: "interest", key: "tech", liked: false }],
      "Harold",
    );
    expect(profile.interests).toEqual(["learning"]);
  });

  it("maps stairs: avoid → walker, hassle → cane, fine → full", () => {
    const avoid = answersToProfile([{ kind: "mobility", key: "avoid" }], "A");
    const hassle = answersToProfile([{ kind: "mobility", key: "hassle" }], "B");
    const fine = answersToProfile([{ kind: "mobility", key: "fine" }], "C");
    expect(avoid.mobility).toBe("walker");
    expect(hassle.mobility).toBe("cane");
    expect(fine.mobility).toBe("full");
  });

  it("derives transport from mobility answer", () => {
    const walker = answersToProfile([{ kind: "mobility", key: "avoid" }], "A");
    expect(walker.transport).toEqual(["bus", "paratransit", "family"]);
    const full = answersToProfile([{ kind: "mobility", key: "fine" }], "C");
    expect(full.transport).toEqual(["drive", "walk", "bus"]);
  });

  it("maps travel bucket into maxTravelMin", () => {
    const profile = answersToProfile([{ kind: "travel", min: 15 }], "A");
    expect(profile.maxTravelMin).toBe(15);
  });

  it("collects all picked time slots", () => {
    const profile = answersToProfile(
      [
        { kind: "times", keys: ["morning", "afternoon"] },
        { kind: "times", keys: ["evening"] },
      ],
      "A",
    );
    expect(profile.times).toEqual(["morning", "afternoon", "evening"]);
  });

  it("falls back to defaults for missing answers", () => {
    const profile = answersToProfile([], "");
    expect(profile.maxTravelMin).toBe(30);
    expect(profile.times).toEqual(["morning", "afternoon"]);
    expect(profile.budgetPerWeek).toBe(10);
    expect(profile.name).toBe("Friend");
    expect(profile.interests).toEqual(["learning"]);
  });

  it("always produces a schema-valid Profile", () => {
    const profile = answersToProfile(
      [
        { kind: "interest", key: "cooking", liked: true },
        { kind: "times", keys: ["evening"] },
        { kind: "travel", min: 45 },
        { kind: "mobility", key: "hassle" },
        { kind: "budget", amount: 25 },
      ],
      "Yihong",
    );
    expect(Profile.safeParse(profile).success).toBe(true);
    expect(profile.name).toBe("Yihong" satisfies string);
    expect(profile.interests.length).toBeGreaterThan(0);
    expect(profile.transport.length).toBeGreaterThan(0);
    expect((profile as ProfileType).mobility).toBe("cane");
  });
});


describe("swipeDirection", () => {
  it("commits at 48px in either direction", () => {
    expect(swipeDirection(48)).toBe(1);
    expect(swipeDirection(-48)).toBe(-1);
  });
  it("snaps back below the threshold", () => {
    for (const distance of [0, 47, -47]) expect(swipeDirection(distance)).toBeNull();
  });
});

describe("undoAnswer", () => {
  it("keeps an empty history empty", () => {
    expect(undoAnswer([])).toEqual([]);
  });
  it("removes the last answer without changing the original history", () => {
    const history: Answer[] = [
      { kind: "interest", key: "music", liked: true },
      { kind: "budget", amount: 50 },
    ];
    const result = undoAnswer(history);
    expect(result).toEqual([history[0]]);
    expect(history).toHaveLength(2);
    expect(answersToProfile(result.filter((a): a is Answer => a !== null), "A").budgetPerWeek).toBe(10);
  });
  it("undoes a skipped card without removing the preceding answer", () => {
    const answer: Answer = { kind: "interest", key: "music", liked: true };
    expect(undoAnswer([answer, null])).toEqual([answer]);
  });
  it("allows an undone answer to be replaced without retaining the old value", () => {
    const history: Answer[] = [{ kind: "travel", min: 90 }];
    const revised = [...undoAnswer(history), { kind: "travel", min: 15 } as Answer];
    expect(answersToProfile(revised.filter((a): a is Answer => a !== null), "A").maxTravelMin).toBe(15);
  });
});
