import { describe, expect, it } from "vitest";
import { answersToProfile } from "@/components/onboarding/CardDeck";
import { Profile, type Profile as ProfileType } from "@/lib/schema";

function p(partial: Partial<Profile>): Profile {
  return {
    name: "Test",
    interests: ["music"],
    mobility: "full",
    transport: ["drive", "walk", "bus"],
    maxTravelMin: 30,
    times: ["morning"],
    budgetPerWeek: 10,
    hearingImpaired: false,
    prefersSmallGroups: false,
    ...partial,
  };
}

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
