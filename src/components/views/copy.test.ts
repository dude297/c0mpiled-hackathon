import { describe, expect, it } from "vitest";
import { barrierText, dayFull, realName, timesList, travelPlain, travelText, whenText, withoutFallbackName } from "./copy";

describe("realName", () => {
  it("blank / Friend fallback → null", () => {
    expect(realName("")).toBeNull();
    expect(realName("  ")).toBeNull();
    expect(realName("Friend")).toBeNull();
    expect(realName(undefined)).toBeNull();
  });
  it("real name kept", () => expect(realName(" Margaret ")).toBe("Margaret"));
});

describe("days and times", () => {
  it("full weekday names", () => {
    expect(dayFull("Tue")).toBe("Tuesday");
    expect(whenText("Wed afternoon")).toBe("Wednesday afternoon");
    expect(whenText("sometime")).toBe("sometime");
  });
  it("times list", () => {
    expect(timesList(["morning", "evening"])).toBe("mornings and evenings");
    expect(timesList(["morning"])).toBe("mornings");
  });
});

describe("travel", () => {
  it("mode words", () => {
    expect(travelText("family", 8)).toBe("Family ride, about 8 min");
    expect(travelText("bus", 15)).toBe("Bus, about 15 min");
    expect(travelText("paratransit", 30)).toBe("Senior shuttle, about 30 min");
    expect(travelText("drive", 10)).toBe("Drive, about 10 min");
    expect(travelText("walk", 5)).toBe("Walk, about 5 min");
  });
  it("engine string", () => expect(travelPlain("family, 8 min")).toEqual({ mode: "Family ride", text: "Family ride, about 8 min" }));
});

describe("barrierText", () => {
  it("time, no name → you", () =>
    expect(barrierText({ rule: "time", detail: "Meets Tue afternoon; Friend is only available morning/evening" }, null)).toBe(
      "Meets Tuesday afternoons. You're free mornings and evenings",
    ));
  it("time, with name", () =>
    expect(barrierText({ detail: "Meets Thu evening; Margaret is only available morning/afternoon" }, "Margaret")).toBe(
      "Meets Thursday evenings. Margaret is free mornings and afternoons",
    ));
  it("cost", () => expect(barrierText({ detail: "$20/week exceeds the $10 budget" }, null)).toBe("Costs $20 a week, over your $10 budget"));
  it("cost, named", () => expect(barrierText({ detail: "$20/week exceeds the $10 budget" }, "Margaret")).toBe("Costs $20 a week, over Margaret's $10 budget"));
  it("travel", () => expect(barrierText({ detail: "family, 8 min" }, null)).toBe("Family ride, about 8 min"));
  it("too far", () =>
    expect(barrierText({ detail: "Fastest option is bus at 45 min; limit is 30 min" }, null)).toBe("Too far: the bus takes about 45 min, over your 30-minute limit"));
  it("no route", () => expect(barrierText({ detail: "No way to get there using bus/family" }, null)).toBe("No way to get there by bus or family ride"));
  it("stairs", () => expect(barrierText({ detail: "Entrance has stairs; Margaret uses a walker" }, null)).toBe("Entrance has stairs, no step-free way in"));
  it("unknown text loses Friend", () => expect(barrierText({ detail: "Friend prefers quiet" }, null)).toBe("You prefers quiet"));
});

describe("withoutFallbackName", () => {
  it("Friend → you/your", () =>
    expect(withoutFallbackName("1 activity Friend can actually attend. Friend's week is light.", null)).toBe(
      "1 activity you can actually attend. Your week is light.",
    ));
  it("real names untouched", () => expect(withoutFallbackName("Friend can go", "Friend Smith")).toBe("Friend can go"));
});
