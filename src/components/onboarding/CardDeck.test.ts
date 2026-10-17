import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANSWER_LOCKOUT_MS, ANSWER_MODES, answersToProfile, CardDeck, changeAnswerMode, COMFORT_OPTIONS, comfortFromKeys, comfortToKeys, INTEREST_COUNT, isLockedOut, likedInterests, pickedToHistory, replaceAnswer, replaceInterests, reviewRows, swipeDirection, toggleChoice, toggleKey, TRANSPORT_OPTIONS, undoAnswer, WALKING_AID_OPTIONS, type Answer } from "@/components/onboarding/CardDeck";
import { HandsFree } from "@/components/handsfree/HandsFree";
import { Profile, type Profile as ProfileType } from "@/lib/schema";

// The three required answers; tests about other fields add them so a full Profile comes back.
const WALK: Answer = { kind: "mobility", key: "full" };
const BUS: Answer = { kind: "transport", modes: ["bus"] };
const NEITHER: Answer = { kind: "comfort", hearing: false, smallGroups: false };

function profileOf(answers: (Answer | null)[], name: string): ProfileType {
  const result = answersToProfile([...answers.filter((a): a is Answer => a !== null), WALK, BUS, NEITHER], name);
  if (!result.ok) throw new Error(`incomplete: ${result.missing.join(",")}`);
  return result.profile;
}

describe("answersToProfile — PR #12 review: never infer mobility or transport", () => {
  it("lead repro: an old stairs 'fine' answer and no transport answer is incomplete, never drive", () => {
    const result = answersToProfile([{ kind: "mobility", key: "fine" } as unknown as Answer], "QA no car");
    expect(result).toEqual({ ok: false, missing: ["mobility", "transport", "comfort"] });
    expect(JSON.stringify(result)).not.toContain("drive");
  });

  it("lead repro (avoid case): no walker and no paratransit/family invented", () => {
    const result = answersToProfile([{ kind: "mobility", key: "avoid" } as unknown as Answer], "QA");
    expect(result).toEqual({ ok: false, missing: ["mobility", "transport", "comfort"] });
  });

  it("walking aid without transport is incomplete; transport without walking aid is incomplete", () => {
    expect(answersToProfile([{ kind: "mobility", key: "walker" }, NEITHER], "A")).toEqual({ ok: false, missing: ["transport"] });
    expect(answersToProfile([{ kind: "transport", modes: ["drive"] }, NEITHER], "A")).toEqual({ ok: false, missing: ["mobility"] });
    expect(answersToProfile([{ kind: "mobility", key: "full" }, { kind: "transport", modes: [] }, NEITHER], "A")).toEqual({ ok: false, missing: ["transport"] });
  });

  it("walker + bus only yields mobility walker and transport ['bus'] exactly", () => {
    const result = answersToProfile([{ kind: "mobility", key: "walker" }, { kind: "transport", modes: ["bus"] }, NEITHER], "Ruth");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.mobility).toBe("walker");
    expect(result.profile.transport).toEqual(["bus"]);
  });

  it("transport is exactly what was picked for every walking aid (no mobility→transport path)", () => {
    for (const aid of WALKING_AID_OPTIONS) {
      for (const mode of TRANSPORT_OPTIONS) {
        const result = answersToProfile([{ kind: "mobility", key: aid.key }, { kind: "transport", modes: [mode.key] }, NEITHER], "A");
        expect(result.ok && result.profile.mobility).toBe(aid.key);
        expect(result.ok && result.profile.transport).toEqual([mode.key]);
      }
    }
  });

  it("walking aid maps 1:1 and multi-select transport keeps every pick", () => {
    expect(WALKING_AID_OPTIONS.map((o) => o.key)).toEqual(["full", "cane", "walker", "wheelchair"]);
    const result = answersToProfile([{ kind: "mobility", key: "wheelchair" }, { kind: "transport", modes: ["family", "paratransit"] }, NEITHER], "A");
    expect(result.ok && result.profile.mobility).toBe("wheelchair");
    expect(result.ok && [...result.profile.transport].sort()).toEqual(["family", "paratransit"]);
  });

  it("no stairs card or stairs mapping remains in the onboarding source", () => {
    const src = readFileSync(new URL("./CardDeck.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/stair/i);
    expect(src).not.toMatch(/\["drive", "walk", "bus"\]|\["bus", "paratransit", "family"\]/);
  });

  it("walking-aid and transport picks honor the double-tap lockout (no pre-selected answer from a second tap)", () => {
    const src = readFileSync(new URL("./CardDeck.tsx", import.meta.url), "utf8");
    const choiceCard = src.slice(src.indexOf("function ChoiceCard"), src.indexOf("function TimeChoices"));
    expect(choiceCard).toMatch(/onChange=\{\(\) => \{\s*if \(locked\(\)\) return;/);
    expect(src.match(/locked=\{locked\}/g)).toHaveLength(3);
    expect(src).toMatch(/const locked = \(\) => inLockout\(lastRecordAt\)/);
  });
});

describe("answersToProfile — PR #12 review: hearing + group size asked explicitly", () => {
  it("lead probe: walking aid + transport but no comfort answer is incomplete, never defaulted to false", () => {
    const result = answersToProfile([WALK, BUS], "QA");
    expect(result).toEqual({ ok: false, missing: ["comfort"] });
    expect(JSON.stringify(result)).not.toMatch(/hearingImpaired|prefersSmallGroups/);
  });

  it("missing comfort is reported alongside the other required fields", () => {
    const result = answersToProfile([], "QA");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.missing).toContain("comfort");
  });

  it("a malformed comfort answer counts as unanswered", () => {
    const bad = { kind: "comfort", hearing: "yes" } as unknown as Answer;
    expect(answersToProfile([WALK, BUS, bad], "QA")).toEqual({ ok: false, missing: ["comfort"] });
  });

  it("Neither → both false, from an explicit answer", () => {
    const answer = comfortFromKeys(["neither"]);
    expect(answer).toEqual({ kind: "comfort", hearing: false, smallGroups: false });
    const result = answersToProfile([WALK, BUS, answer], "A");
    expect(result.ok && result.profile.hearingImpaired).toBe(false);
    expect(result.ok && result.profile.prefersSmallGroups).toBe(false);
    expect(result.ok && result.defaults).not.toContain("comfort");
  });

  it("each option maps to its own boolean", () => {
    const hearing = answersToProfile([WALK, BUS, comfortFromKeys(["hearing"])], "A");
    expect(hearing.ok && [hearing.profile.hearingImpaired, hearing.profile.prefersSmallGroups]).toEqual([true, false]);
    const groups = answersToProfile([WALK, BUS, comfortFromKeys(["smallGroups"])], "A");
    expect(groups.ok && [groups.profile.hearingImpaired, groups.profile.prefersSmallGroups]).toEqual([false, true]);
    const both = answersToProfile([WALK, BUS, comfortFromKeys(["hearing", "smallGroups"])], "A");
    expect(both.ok && [both.profile.hearingImpaired, both.profile.prefersSmallGroups]).toEqual([true, true]);
    expect(both.ok && Profile.safeParse(both.profile).success).toBe(true);
  });

  it("options are the two questions plus an exclusive Neither", () => {
    expect(COMFORT_OPTIONS.map((o) => o.key)).toEqual(["hearing", "smallGroups", "neither"]);
    expect(COMFORT_OPTIONS.map((o) => o.label)).toEqual(["Noisy rooms are hard for me to hear in", "I prefer small groups", "Neither of these"]);
  });

  it("Neither clears the others; any other pick clears Neither", () => {
    expect(toggleChoice(["hearing", "smallGroups"], "neither", "neither")).toEqual(["neither"]);
    expect(toggleChoice(["neither"], "hearing", "neither")).toEqual(["hearing"]);
    expect(toggleChoice(["hearing"], "smallGroups", "neither")).toEqual(["hearing", "smallGroups"]);
    expect(toggleChoice(["neither"], "neither", "neither")).toEqual([]);
    expect(toggleChoice(["drive"], "bus")).toEqual(["drive", "bus"]);
  });

  it("Change re-opens with the saved picks (Neither when both false)", () => {
    expect(comfortToKeys({ hearing: false, smallGroups: false })).toEqual(["neither"]);
    expect(comfortToKeys({ hearing: true, smallGroups: true })).toEqual(["hearing", "smallGroups"]);
  });

  it("card sits right after transport and Continue is gated on a pick", () => {
    const src = readFileSync(new URL("./CardDeck.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/\{ type: "transport" \},\s*\{ type: "comfort" \},/);
    expect(src).toMatch(/heading="Anything else that helps\?"\s*helper="Pick any that apply\."/);
    expect(src).toContain("disabled={disabled || ordered.length === 0}");
    expect(src).not.toMatch(/hearingImpaired: false|prefersSmallGroups: false/);
  });
});

describe("answersToProfile", () => {
  it("maps liked interests only", () => {
    const profile = profileOf(
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
    const profile = profileOf([{ kind: "interest", key: "tech", liked: false }], "Harold");
    expect(profile.interests).toEqual(["learning"]);
  });

  it("maps travel bucket into maxTravelMin", () => {
    expect(profileOf([{ kind: "travel", min: 15 }], "A").maxTravelMin).toBe(15);
  });

  it("collects all picked time slots", () => {
    const profile = profileOf(
      [
        { kind: "times", keys: ["morning", "afternoon"] },
        { kind: "times", keys: ["evening"] },
      ],
      "A",
    );
    expect(profile.times).toEqual(["morning", "afternoon", "evening"]);
  });

  it("falls back to defaults for missing optional answers and reports which were defaulted", () => {
    const result = answersToProfile([WALK, BUS, NEITHER], "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.defaults).toEqual(["interests", "times", "travel", "budget"]);
    expect(result.profile.maxTravelMin).toBe(30);
    expect(result.profile.times).toEqual(["morning", "afternoon"]);
    expect(result.profile.budgetPerWeek).toBe(10);
    expect(result.profile.name).toBe("Friend");
    expect(result.profile.interests).toEqual(["learning"]);
  });

  it("always produces a schema-valid Profile", () => {
    const result = answersToProfile(
      [
        { kind: "interest", key: "cooking", liked: true },
        { kind: "times", keys: ["evening"] },
        { kind: "travel", min: 45 },
        { kind: "mobility", key: "cane" },
        { kind: "transport", modes: ["family", "walk"] },
        { kind: "comfort", hearing: true, smallGroups: false },
        { kind: "budget", amount: 25 },
      ],
      "Yihong",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.defaults).toEqual([]);
    expect(Profile.safeParse(result.profile).success).toBe(true);
    expect(result.profile.name).toBe("Yihong");
    expect(result.profile.mobility).toBe("cane");
    expect(result.profile.transport).toEqual(["family", "walk"]);
  });
});

describe("review step", () => {
  const full: (Answer | null)[] = [
    ...pickedToHistory(["music"], INTEREST_COUNT),
    null, // times skipped → default
    { kind: "travel", min: 15 },
    { kind: "mobility", key: "walker" },
    { kind: "transport", modes: ["bus", "family"] },
    { kind: "comfort", hearing: true, smallGroups: false },
    { kind: "budget", amount: 0 },
  ];
  const answered = (h: (Answer | null)[]) => h.filter((a): a is Answer => a !== null);

  it("lists every answer in plain words and labels defaults", () => {
    const rows = reviewRows(answered(full));
    expect(rows.map((r) => r.field)).toEqual(["interests", "times", "travel", "mobility", "transport", "hearing", "groupSize", "budget"]);
    const by = Object.fromEntries(rows.map((r) => [r.field, r]));
    expect(by.interests).toMatchObject({ value: "Music & singing", isDefault: false });
    expect(by.times).toMatchObject({ value: "Mornings, Afternoons", isDefault: true });
    expect(by.travel).toMatchObject({ value: "A short drive (about 15 minutes)", isDefault: false });
    expect(by.mobility).toMatchObject({ value: "A walker", isDefault: false });
    expect(by.transport).toMatchObject({ value: "Bus or train, Family or friends drive me", isDefault: false });
    expect(by.hearing).toMatchObject({ label: "Hearing", value: "Noisy rooms are hard to hear in", isDefault: false });
    expect(by.groupSize).toMatchObject({ label: "Group size", value: "Any size is fine", isDefault: false });
    expect(by.budget).toMatchObject({ value: "Free only ($0 a week)", isDefault: false });
  });

  it("hearing + group size rows read the explicit answer and never show a guessed value", () => {
    const by = (answers: Answer[]) => Object.fromEntries(reviewRows(answers).map((r) => [r.field, r.value]));
    expect(by([WALK, BUS, NEITHER])).toMatchObject({ hearing: "No trouble hearing", groupSize: "Any size is fine" });
    expect(by([WALK, BUS, comfortFromKeys(["smallGroups"])])).toMatchObject({ hearing: "No trouble hearing", groupSize: "Prefers small groups" });
    expect(by([WALK, BUS])).toMatchObject({ hearing: "Not answered yet", groupSize: "Not answered yet" });
  });

  it("Change on hearing / group size swaps only that answer", () => {
    const comfortIndex = full.findIndex((a) => a?.kind === "comfort");
    const changed = replaceAnswer(full, comfortIndex, comfortFromKeys(["smallGroups"]));
    changed.forEach((a, i) => { if (i !== comfortIndex) expect(a).toBe(full[i]); });
    const result = answersToProfile(answered(changed), "A");
    expect(result.ok && result.profile.hearingImpaired).toBe(false);
    expect(result.ok && result.profile.prefersSmallGroups).toBe(true);
    expect(result.ok && result.profile.transport).toEqual(["bus", "family"]);
    expect(result.ok && result.profile.mobility).toBe("walker");
    expect(result.ok && result.profile.interests).toEqual(["music"]);
    expect(result.ok && result.profile.budgetPerWeek).toBe(0);
  });

  it("labels the interests default when nothing was liked", () => {
    const rows = reviewRows(answered([...pickedToHistory([], INTEREST_COUNT), WALK, BUS, NEITHER]));
    expect(rows[0]).toMatchObject({ field: "interests", value: "Learning new things", isDefault: true });
  });

  it("Change on how you get places swaps only that answer", () => {
    const transportIndex = full.findIndex((a) => a?.kind === "transport");
    const changed = replaceAnswer(full, transportIndex, { kind: "transport", modes: ["drive"] });
    expect(changed).toHaveLength(full.length);
    changed.forEach((a, i) => { if (i !== transportIndex) expect(a).toBe(full[i]); });
    const result = answersToProfile(answered(changed), "A");
    expect(result.ok && result.profile.transport).toEqual(["drive"]);
    expect(result.ok && result.profile.mobility).toBe("walker");
    expect(result.ok && result.profile.maxTravelMin).toBe(15);
    expect(result.ok && result.profile.budgetPerWeek).toBe(0);
    expect(result.ok && result.profile.hearingImpaired).toBe(true);
  });

  it("Change on interests keeps every later answer", () => {
    const changed = replaceInterests(full, ["gardening", "faith"]);
    expect(changed.slice(INTEREST_COUNT)).toEqual(full.slice(INTEREST_COUNT));
    const result = answersToProfile(answered(changed), "A");
    expect(result.ok && [...result.profile.interests].sort()).toEqual(["faith", "gardening"]);
    expect(result.ok && result.profile.transport).toEqual(["bus", "family"]);
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
    expect(profileOf(result, "A").budgetPerWeek).toBe(10);
  });
  it("undoes a skipped card without removing the preceding answer", () => {
    const answer: Answer = { kind: "interest", key: "music", liked: true };
    expect(undoAnswer([answer, null])).toEqual([answer]);
  });
  it("allows an undone answer to be replaced without retaining the old value", () => {
    const history: Answer[] = [{ kind: "travel", min: 90 }];
    const revised = [...undoAnswer(history), { kind: "travel", min: 15 } as Answer];
    expect(profileOf(revised, "A").maxTravelMin).toBe(15);
  });
});

describe("easier view interest grid", () => {
  it("toggles a tile on and off", () => {
    expect(toggleKey([], "music")).toEqual(["music"]);
    expect(toggleKey(["music", "tech"], "music")).toEqual(["tech"]);
  });

  it("Continue records one answer per tile and maps picks into the profile", () => {
    const history = pickedToHistory(["tech", "gardening", "faith"], INTEREST_COUNT);
    expect(history).toHaveLength(INTEREST_COUNT);
    expect(history.every((a) => a.kind === "interest")).toBe(true);
    const profile = profileOf([...history, { kind: "times", keys: ["evening"] }], "Rosa");
    expect([...profile.interests].sort()).toEqual(["faith", "gardening", "tech"]);
    expect(Profile.safeParse(profile).success).toBe(true);
  });

  it("allows zero picks and falls back to the learning default", () => {
    const history = pickedToHistory([], INTEREST_COUNT);
    expect(history).toHaveLength(INTEREST_COUNT);
    expect(profileOf(history, "A").interests).toEqual(["learning"]);
  });

  it("round-trips picks so Back to the grid keeps selections", () => {
    const history = pickedToHistory(["cooking", "music"], INTEREST_COUNT);
    expect([...likedInterests(history)].sort()).toEqual(["cooking", "music"]);
  });

  it("keeps swipe answers when switching to the grid and grid picks when switching back", () => {
    const swiped: Answer[] = [
      { kind: "interest", key: "music", liked: true },
      { kind: "interest", key: "gardening", liked: false },
    ];
    const seeded = likedInterests(swiped);
    expect(seeded).toEqual(["music"]);
    const back = pickedToHistory(toggleKey(seeded, "crafts"), swiped.length);
    // crafts is card 5, so the swipe deck resumes after it with nothing lost
    expect(back).toHaveLength(5);
    expect(profileOf(back, "A").interests).toEqual(["music", "crafts"]);
  });
});

describe("first-step answer mode picker", () => {
  const partial: (Answer | null)[] = [
    { kind: "interest", key: "music", liked: true },
    { kind: "interest", key: "gardening", liked: false },
    null,
  ];

  it("starts with the three named radio options before any interest card, with both demos available", () => {
    const html = renderToStaticMarkup(createElement(CardDeck, { onComplete: () => {}, onDemo: () => {} }));
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    for (const mode of ANSWER_MODES) expect(html).toContain(mode.label);
    expect(html).toContain("Demo: Margaret");
    expect(html).toContain("Demo: Harold");
    expect(html).toContain("data-step-focus");
    expect(html).not.toContain("Would you enjoy this?");
    expect(html).not.toContain("Turn on camera");
  });

  it("hands-free exposes a camera consent control immediately, without a second mode toggle", () => {
    const html = renderToStaticMarkup(createElement(HandsFree, { label: "Music", onAnswer: () => {} }));
    expect(html).toContain("Turn on camera");
    expect(html).toContain("Your camera stays on this device");
    expect(html).not.toContain("Hands-free (camera):");
    expect(html).not.toContain("Stop hands-free");
  });

  it("switches swipe and hands-free without changing liked, declined or skipped answers or the cursor", () => {
    const hands = changeAnswerMode("swipe", "hands", partial, []);
    expect(hands.history).toEqual(partial);
    expect(changeAnswerMode("hands", "swipe", hands.history, hands.picked).history).toEqual(partial);
    expect(partial).toHaveLength(3);
  });

  it.each(["swipe", "hands"] as const)("seeds easier view from %s answers and preserves changed picks on return", (mode) => {
    const grid = changeAnswerMode(mode, "easy", partial, []);
    expect(grid).toEqual({ history: partial, picked: ["music"] });
    const resumed = changeAnswerMode("easy", mode, grid.history, ["music", "crafts"]);
    expect(resumed.history).toHaveLength(5);
    expect(likedInterests(resumed.history)).toEqual(["music", "crafts"]);
    expect(profileOf(resumed.history, "A").interests).toEqual(["music", "crafts"]);
    expect(partial).toHaveLength(3);
  });

  it("keeps progress when every grid tile is cleared, and a final tile pick is not dropped", () => {
    const cleared = changeAnswerMode("easy", "hands", partial, []);
    expect(cleared.history).toHaveLength(partial.length);
    expect(likedInterests(cleared.history)).toEqual([]);
    const lastTile = changeAnswerMode("easy", "hands", partial, ["tech"]);
    expect(lastTile.history).toHaveLength(INTEREST_COUNT);
    expect(likedInterests(lastTile.history)).toEqual(["tech"]);
  });

  it("reselecting easier view keeps unsaved tile picks", () => {
    expect(changeAnswerMode("easy", "easy", partial, ["tech"])).toEqual({ history: partial, picked: ["tech"] });
  });

  it("never rewrites later walking-aid, transport or comfort answers", () => {
    const history = [...pickedToHistory(["music"], INTEREST_COUNT), WALK, BUS, NEITHER];
    expect(changeAnswerMode("easy", "hands", history, ["tech"]).history).toEqual(history);
    expect(changeAnswerMode("hands", "easy", history, []).history).toEqual(history);
  });
});

describe("isLockedOut", () => {
  it("blocks a second answer inside the lockout window, allows it after", () => {
    expect(isLockedOut(-Infinity, 0)).toBe(false);
    expect(isLockedOut(1000, 1000 + 120)).toBe(true);
    expect(isLockedOut(1000, 1000 + ANSWER_LOCKOUT_MS - 1)).toBe(true);
    expect(isLockedOut(1000, 1000 + ANSWER_LOCKOUT_MS)).toBe(false);
  });
});
