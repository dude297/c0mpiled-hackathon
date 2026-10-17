import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import { runScenario } from "@/domain/engine";
import type { AnalysisResult, Profile } from "@/lib/schema";
import { _resetShareStore, _shareStoreSize, createShare, firstNameFrom, getShare, ID_RE, MAX_SHARES, redact, revokeShare, ShareInput } from "./share";

const SECRET = "SECRET-2425-Channing-555-0100";
const resultFor = (p: Profile): AnalysisResult => {
  const out = runScenario({ profile: p });
  return {
    ...out,
    // plant secrets everywhere the client controls free text
    plan: out.plan.map((i) => ({
      ...i,
      name: `${i.name} ${SECRET}`,
      travel: `${i.travel} ${SECRET}`,
      barriers: i.barriers.map((b) => ({ ...b, detail: `${b.detail} ${SECRET}`, mitigation: `${b.mitigation} ${SECRET}` })),
    })),
    items: [...out.items, { label: SECRET, value: SECRET }],
    evidence: [...out.evidence, { claim: SECRET, source: SECRET, verified: true }],
    blocked: [...out.blocked, { name: SECRET, barriers: [] }],
    explanation: `${p.name} uses a ${p.mobility}, lives at ${SECRET}, hearing impaired: ${p.hearingImpaired}`,
    dataSource: "mock",
  };
};

describe("redact (allowlist)", () => {
  const cases = Object.entries(DEMO_PROFILES).flatMap(([key, base]) =>
    (["full", "cane", "walker", "wheelchair"] as const).flatMap((mobility) =>
      [true, false].map((hearingImpaired) => ({ key, profile: { ...base, mobility, hearingImpaired } })),
    ),
  );

  it.each(cases)("$key $profile.mobility hearing=$profile.hearingImpaired leaks nothing", ({ profile }) => {
    const snap = redact(ShareInput.parse({ result: resultFor(profile), consent: true }));
    const out = JSON.stringify(snap);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(profile.name);
    expect(out).not.toMatch(/\b(cane|walker|wheelchair|paratransit|family|hearing|impaired|budget)\b/i);
    expect(snap.displayName).toBe("Someone");
    for (const item of snap.items) {
      const a = ACTIVITIES.find((x) => x.name === item.name)!;
      expect(a).toBeDefined();
      expect(item.when).toBe(`${a.day} ${a.time}`);
      expect(["drive", "bus", "walk", "arranged ride"]).toContain(item.travel);
    }
  });

  it("firstNameOnly shows only a parsed first name, never free text", () => {
    const r = resultFor({ ...DEMO_PROFILES.margaret, name: "Margaret Q. Public" });
    const snap = redact(ShareInput.parse({ result: r, consent: true, firstNameOnly: true }));
    expect(snap.displayName).toBe("Margaret");
    expect(JSON.stringify(snap)).not.toContain("Public");
  });

  it("drops tampered items: unknown ids, duplicates; maps paratransit/family to arranged ride", () => {
    const base = resultFor(DEMO_PROFILES.harold);
    const r: AnalysisResult = {
      ...base,
      plan: [
        { activityId: "evil<script>", name: SECRET, when: SECRET, travel: SECRET, costPerWeek: 0, score: 0, barriers: [] },
        { activityId: "bridge", name: SECRET, when: SECRET, travel: "paratransit, 25 min", costPerWeek: 999, score: 0, barriers: [{ rule: SECRET, severity: "soft", detail: SECRET }] },
        { activityId: "bridge", name: "dup", when: "x", travel: "bus", costPerWeek: 0, score: 0, barriers: [] },
        { activityId: "garden", name: "x", when: "x", travel: "family, 8 min", costPerWeek: 0, score: 0, barriers: [] },
      ],
    };
    const snap = redact(ShareInput.parse({ result: r, consent: true }));
    expect(snap.items.map((i) => i.name)).toEqual(["Central Library Community Room Cards", "UC Botanical Garden Walk"]);
    expect(snap.items.map((i) => i.travel)).toEqual(["arranged ride", "arranged ride"]);
    expect(snap.items[0].costPerWeek).toBe(0);
    expect(snap.items[0].tips).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain(SECRET);
  });

  it("rejects missing consent, extra fields (e.g. profile), bad expiry", () => {
    const result = resultFor(DEMO_PROFILES.margaret);
    expect(ShareInput.safeParse({ result }).success).toBe(false);
    expect(ShareInput.safeParse({ result, consent: false }).success).toBe(false);
    expect(ShareInput.safeParse({ result, consent: true, profile: DEMO_PROFILES.margaret }).success).toBe(false);
    expect(ShareInput.safeParse({ result, consent: true, expiresInDays: 0 }).success).toBe(false);
    expect(ShareInput.safeParse({ result, consent: true, expiresInDays: 31 }).success).toBe(false);
    expect(ShareInput.safeParse({ result, consent: true, expiresInDays: 30 }).success).toBe(true);
  });
});

describe("firstNameFrom", () => {
  it.each([
    ["3 activities Margaret can actually attend this week.", "Margaret"],
    ["1 activity Harold Smith can actually attend this week.", "Harold"],
    ["No activity fits Zoë's constraints yet. See what's blocking each one.", "Zoë"],
    ["Margaret lives at 12 Elm St", null],
    ["2 activities <img src=x> can actually attend this week.", null],
    ["2 activities 555-0100 can actually attend this week.", null],
  ])("%s -> %s", (s, want) => expect(firstNameFrom(s)).toBe(want));
});

describe("share store", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", ""); // memory store, even when a local Supabase env is loaded
    _resetShareStore();
  });
  afterEach(() => vi.unstubAllEnvs());
  const input = () => ShareInput.parse({ result: resultFor(DEMO_PROFILES.margaret), consent: true });

  it("issues unguessable 128-bit ids and separate 256-bit revoke tokens", async () => {
    const a = await createShare(input());
    const b = await createShare(input());
    expect(a.id).toMatch(ID_RE);
    expect(a.id).not.toBe(b.id);
    expect(a.revokeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.revokeToken).not.toContain(a.id);
  });

  it("expires after expiresInDays", async () => {
    const t0 = new Date("2026-10-17T00:00:00Z");
    const { id } = await createShare({ ...input(), expiresInDays: 1 }, t0);
    expect(await getShare(id, new Date(t0.getTime() + 86_399_000))).not.toBeNull();
    expect(await getShare(id, new Date(t0.getTime() + 86_400_000))).toBeNull();
  });

  it("revokes only with the right token", async () => {
    const { id, revokeToken } = await createShare(input());
    expect(await revokeShare(id, "wrong")).toBe(false);
    expect(await revokeShare("nope", revokeToken)).toBe(false);
    expect(await getShare(id)).not.toBeNull();
    expect(await revokeShare(id, revokeToken)).toBe(true);
    expect(await getShare(id)).toBeNull();
    expect(await revokeShare(id, revokeToken)).toBe(false);
  });

  it("caps at MAX_SHARES, pruning expired first", { timeout: 30_000 }, async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    for (let i = 0; i < MAX_SHARES; i++) await createShare(input(), old);
    expect(_shareStoreSize()).toBe(MAX_SHARES);
    await createShare(input()); // all old ones are expired by now
    expect(_shareStoreSize()).toBe(1);
    for (let i = 0; i < MAX_SHARES + 5; i++) await createShare(input());
    expect(_shareStoreSize()).toBe(MAX_SHARES);
  });
});
