import { describe, expect, it } from "vitest";
import type { Grant, Person } from "./contract";
import { MAYA_PROFILE } from "./fixtures";
import { changesFromFeedback, pageVersions, profileAccess } from "./profiles";
import { createMemoryStore } from "./store";

const ID = "7d1f0a52-4c1e-4b8a-9a0e-6d6179619999";
const person: Person = { personId: ID, profile: MAYA_PROFILE, timezone: "UTC", selfUserId: "self-x", checkInSchedule: null, createdAt: "t0", createdBy: "cg-a" };
const g = (userId: string, scopes: Grant["scopes"]): Grant => ({ personId: ID, userId, scopes, grantedBy: "cg-a", grantedAt: "t0" });

describe("profileAccess", () => {
  it("404 without a grant, 403 without scope, self allowed except revert", () => {
    expect(() => profileAccess(person, null, "cg-z", "read")).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => profileAccess(person, g("cg-v", ["view"]), "cg-v", "propose")).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => profileAccess(person, g("cg-c", ["checkin"]), "cg-c", "decide")).toThrow(expect.objectContaining({ status: 403 }));
    expect(profileAccess(person, g("cg-c", ["checkin"]), "cg-c", "propose").scopes).toEqual(["checkin"]);
    expect(profileAccess(person, null, "self-x", "decide").isSelf).toBe(true);
    expect(() => profileAccess(person, null, "self-x", "revert")).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => profileAccess(person, { ...g("cg-m", ["manage"]), revokedAt: "t1" }, "cg-m", "read")).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("changesFromFeedback", () => {
  it("keeps only proposed, valid, non-no-op patches", () => {
    const patch = (field: string, to: unknown, status = "proposed") => ({ id: field, field, from: 0, to, evidence: `e-${field}`, status }) as never;
    const r = changesFromFeedback(MAYA_PROFILE, {
      preferencePatches: [patch("maxTravelMin", 20), patch("budgetPerWeek", -5), patch("prefersSmallGroups", true), patch("hearingImpaired", true, "applied")],
    });
    expect(r.changes).toEqual({ maxTravelMin: 20 }); // -5 invalid, prefersSmallGroups already true, applied skipped
    expect(r.evidence).toContain("e-maxTravelMin");
  });
});

describe("memory store profile ops", () => {
  it("atomic confirm, stale siblings, compare-and-append, pagination", async () => {
    const s = createMemoryStore();
    await s.createPerson(person, g("cg-a", ["view", "checkin", "manage"]));
    const mk = (proposalId: string, changes: object) =>
      s.createProposal({ proposalId, personId: ID, baseVersion: 1, changes, evidence: "e", source: "caregiver", proposedBy: "cg-a", status: "proposed", createdAt: "t" });
    await mk("a", { maxTravelMin: 20 });
    await mk("b", { budgetPerWeek: 5 });
    expect((await s.getPerson(ID))?.profileVersion).toBe(1);
    const at = "t2";
    const ra = await s.decideProposal({ personId: ID, proposalId: "a", decision: "confirmed", expectedVersion: 1, decidedBy: "cg-a", at });
    expect(ra).toMatchObject({ version: { version: 2, profile: { maxTravelMin: 20 } } });
    expect(await s.decideProposal({ personId: ID, proposalId: "b", decision: "confirmed", expectedVersion: 2, decidedBy: "cg-a", at })).toBe("stale");
    expect(await s.appendVersion({ personId: ID, expectedVersion: 1, profile: MAYA_PROFILE, source: "revert", createdBy: "cg-a", at })).toBe("stale");
    expect(await s.appendVersion({ personId: ID, expectedVersion: 2, profile: MAYA_PROFILE, source: "revert", createdBy: "cg-a", at })).toMatchObject({ version: 3 });
    const all = await s.listVersions(ID);
    expect(all.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(pageVersions(all, 2, null)).toMatchObject({ items: [{ version: 3 }, { version: 2 }], nextCursor: "2" });
    expect(pageVersions(all, 2, 2)).toMatchObject({ items: [{ version: 1 }], nextCursor: null });
    await s.deletePerson(ID);
    expect(await s.listVersions(ID)).toEqual([]);
    expect(await s.listProposals(ID)).toEqual([]);
  });
});
