import { describe, expect, it } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import { Profile } from "@/lib/schema";
import { mergeSuggestion } from "./merge";

describe("mergeSuggestion", () => {
  const base = DEMO_PROFILES.margaret;

  it("keeps base for missing keys", () => {
    expect(mergeSuggestion(base, {})).toEqual(base);
    expect(mergeSuggestion(base, null)).toEqual(base);
  });

  it("replaces present keys, arrays included", () => {
    const m = mergeSuggestion(base, { interests: ["tech"], mobility: "cane", hearingImpaired: false });
    expect(m.interests).toEqual(["tech"]);
    expect(m.mobility).toBe("cane");
    expect(m.hearingImpaired).toBe(false);
    expect(m.transport).toEqual(base.transport);
  });

  it("ignores unknown keys and invalid values", () => {
    const m = mergeSuggestion(base, { diagnosis: "x", mobility: "jetpack", maxTravelMin: 9999 } as unknown);
    expect(m).toEqual(base);
    expect("diagnosis" in m).toBe(false);
  });

  it.each(Object.keys(DEMO_PROFILES))("result validates for base %s", (key) => {
    const m = mergeSuggestion(DEMO_PROFILES[key], { name: "Rosa", times: ["evening"], budgetPerWeek: 0 });
    expect(Profile.safeParse(m).success).toBe(true);
    expect(m.name).toBe("Rosa");
  });
});
