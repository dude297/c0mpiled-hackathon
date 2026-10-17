import { describe, expect, it } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import type { CoordinationPlan } from "@/lib/schema";
import { CaregiverError, decideAccess } from "./access";
import { attentionFor } from "./attention";
import { buildCheckIn } from "./checkins";
import { CheckInInput, CreatePersonInput, GrantInput, type CheckIn, type Grant, type Person } from "./contract";
import { decodeCursor, paginate, projectCheckins } from "./history";
import { createMemoryStore } from "./store";
import { nextDateFor, upcomingFor } from "./upcoming";

const PID = "11111111-1111-4111-8111-111111111111";
const person = (over: Partial<Person> = {}): Person => ({
  personId: PID, profile: DEMO_PROFILES.margaret, timezone: "America/Los_Angeles", checkInSchedule: null,
  createdAt: "2026-10-01T00:00:00.000Z", createdBy: "cg-dana", ...over,
});
const grant = (userId: string, scopes: Grant["scopes"]): Grant => ({ personId: PID, userId, scopes, grantedBy: "cg-dana", grantedAt: "2026-10-01T00:00:00.000Z" });
let n = 0;
const ci = (over: Partial<CheckIn>): CheckIn => ({
  checkInId: `c${++n}`, personId: PID, kind: "ok", reporterUserId: "cg-dana", reporterRole: "caregiver", source: "app",
  at: "2026-10-10T00:00:00.000Z", idempotencyKey: `k${n}`, ...over,
});
const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as CaregiverError).status;
  }
};

describe("timezone boundaries (injected now)", () => {
  it("23:30 vs 00:30 local decides whether today counts", () => {
    // 2026-10-17 is a Saturday. LA 23:30 Sat = 06:30Z Sun.
    expect(nextDateFor("Sun", "America/Los_Angeles", new Date("2026-10-18T06:30:00Z"))).toBe("2026-10-18");
    expect(nextDateFor("Sat", "America/Los_Angeles", new Date("2026-10-18T06:30:00Z"))).toBe("2026-10-17"); // still Sat locally: today
    // LA 00:30 Sun = 07:30Z: Sunday is today, Saturday is next week.
    expect(nextDateFor("Sun", "America/Los_Angeles", new Date("2026-10-18T07:30:00Z"))).toBe("2026-10-18");
    expect(nextDateFor("Sat", "America/Los_Angeles", new Date("2026-10-18T07:30:00Z"))).toBe("2026-10-24");
  });

  it("the same instant gives different dates in LA, New York and Kiritimati", () => {
    const now = new Date("2026-10-17T04:30:00Z"); // LA Fri 21:30, NY Sat 00:30, Kiritimati (UTC+14) Sat 18:30
    expect(nextDateFor("Fri", "America/Los_Angeles", now)).toBe("2026-10-16");
    expect(nextDateFor("Fri", "America/New_York", now)).toBe("2026-10-23");
    expect(nextDateFor("Sat", "America/New_York", now)).toBe("2026-10-17");
    const late = new Date("2026-10-17T10:30:00Z"); // Kiritimati Sun 00:30, LA Sat 03:30
    expect(nextDateFor("Sat", "Pacific/Kiritimati", late)).toBe("2026-10-24");
    expect(nextDateFor("Sat", "America/Los_Angeles", late)).toBe("2026-10-17");
    expect(nextDateFor("Sun", "Pacific/Kiritimati", late)).toBe("2026-10-18");
  });

  it("DST fall-back (2026-11-01 in the US) does not shift the date", () => {
    expect(nextDateFor("Sun", "America/Los_Angeles", new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01"); // Sat 23:30 PDT
    expect(nextDateFor("Sun", "America/Los_Angeles", new Date("2026-11-01T09:30:00Z"))).toBe("2026-11-01"); // second 01:30 (PST)
    expect(nextDateFor("Mon", "America/Los_Angeles", new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-02"); // Sun 23:30 PST
    expect(nextDateFor("Sun", "America/Los_Angeles", new Date("2026-11-02T08:30:00Z"))).toBe("2026-11-08"); // Mon 00:30 PST
    // Spring-forward 2027-03-14
    expect(nextDateFor("Sun", "America/New_York", new Date("2027-03-14T07:30:00Z"))).toBe("2027-03-14"); // 03:30 EDT
  });

  it("upcoming skips closed plans and sorts by date", () => {
    const plan = (id: string, when: string, state: CoordinationPlan["state"]) => ({ id, when, state, activityName: id }) as CoordinationPlan;
    const now = new Date("2026-10-17T18:00:00Z"); // Sat
    const up = upcomingFor([plan("a", "Wed afternoon", "READY"), plan("b", "Sun afternoon", "AWAITING_APPROVAL"), plan("c", "Sat morning", "COMPLETED"), plan("d", "Sat morning", "CANCELLED")], "America/Los_Angeles", now);
    expect(up.map((u) => [u.planId, u.nextDate, u.slot])).toEqual([["b", "2026-10-18", "Sun afternoon"], ["a", "2026-10-21", "Wed afternoon"]]);
  });

  it("validates IANA zones", () => {
    const base = { profile: DEMO_PROFILES.margaret };
    expect(CreatePersonInput.safeParse({ ...base, timezone: "Pacific/Kiritimati" }).success).toBe(true);
    expect(CreatePersonInput.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("access", () => {
  it("only grants carry authority; no grant → 404, wrong scope → 403", () => {
    const p = person({ selfUserId: "self-maya" });
    expect(status(() => decideAccess(null, null, "cg-dana", "view"))).toBe(404);
    expect(status(() => decideAccess(p, null, "cg-lee", "view"))).toBe(404);
    expect(status(() => decideAccess(p, grant("cg-lee", ["view"]), "cg-lee", "manage"))).toBe(403);
    expect(status(() => decideAccess(p, grant("cg-lee", ["view"]), "cg-lee", "checkin_or_self"))).toBe(403);
    expect(status(() => decideAccess(p, grant("cg-sam", ["checkin"]), "cg-sam", "manage"))).toBe(403);
    expect(status(() => decideAccess(p, { ...grant("cg-lee", ["view"]), revokedAt: "x" }, "cg-lee", "view"))).toBe(404);
    // self may check in without a grant, but sees nothing else
    expect(decideAccess(p, null, "self-maya", "checkin_or_self").isSelf).toBe(true);
    expect(status(() => decideAccess(p, null, "self-maya", "view"))).toBe(404);
  });

  it("scopes are non-empty and deduped", () => {
    expect(GrantInput.parse({ userId: "cg-lee", scopes: ["view", "view"] }).scopes).toEqual(["view"]);
    expect(GrantInput.safeParse({ userId: "cg-lee", scopes: [] }).success).toBe(false);
    expect(GrantInput.safeParse({ userId: "Bad User", scopes: ["view"] }).success).toBe(false);
  });
});

describe("store", () => {
  it("protects the last manager on revoke and on downgrade", async () => {
    const s = createMemoryStore();
    await s.createPerson(person(), grant("cg-dana", ["view", "checkin", "manage"]));
    expect(await s.revokeGrant(PID, "cg-dana", "t")).toBe("last_manager");
    expect(await s.upsertGrant(grant("cg-dana", ["view"]))).toBe("last_manager");
    await s.upsertGrant(grant("cg-kim", ["manage"]));
    expect(await s.revokeGrant(PID, "cg-dana", "t")).toBe("revoked");
    expect(await s.getGrant(PID, "cg-dana")).toBeNull();
    expect(await s.revokeGrant(PID, "cg-dana", "t")).toBe("not_found");
  });

  it("a plan links to exactly one person", async () => {
    const s = createMemoryStore();
    expect(await s.linkPlan({ personId: PID, planId: "p1", linkedAt: "t", linkedBy: "cg-dana" })).toBe("ok");
    expect(await s.linkPlan({ personId: "22222222-2222-4222-8222-222222222222", planId: "p1", linkedAt: "t", linkedBy: "cg-x" })).toBe("already_linked");
    expect((await s.getPlanLink("p1"))?.personId).toBe(PID);
  });

  it("check-ins are idempotent per (person, reporter, key); a different body conflicts", async () => {
    const s = createMemoryStore();
    const a = ci({ idempotencyKey: "same" });
    expect((await s.recordCheckin(a)).duplicate).toBe(false);
    const again = await s.recordCheckin({ ...a, checkInId: "other" });
    expect(again).toMatchObject({ duplicate: true, checkIn: { checkInId: a.checkInId } });
    expect(again.conflict).toBeUndefined();
    expect((await s.recordCheckin({ ...a, checkInId: "x", kind: "help" })).conflict).toBe(true);
    expect((await s.recordCheckin({ ...a, checkInId: "y", reporterUserId: "cg-lee" })).duplicate).toBe(false);
    expect(await s.listCheckins(PID)).toHaveLength(2);
  });
});

describe("check-ins", () => {
  it("reporterRole is self iff caller is selfUserId; planId must be linked to that person", () => {
    const p = person({ selfUserId: "self-maya" });
    const input = CheckInInput.parse({ kind: "ok", idempotencyKey: "k", note: "  fine  " });
    const base = { person: p, input, links: [], source: "app" as const, now: new Date("2026-10-17T00:00:00Z"), newId: () => "id" };
    expect(buildCheckIn({ ...base, callerId: "self-maya" })).toMatchObject({ reporterRole: "self", note: "fine" });
    expect(buildCheckIn({ ...base, callerId: "cg-dana" }).reporterRole).toBe("caregiver");
    const withPlan = { ...base, callerId: "cg-dana", input: { ...input, planId: "p-other" } };
    expect(status(() => buildCheckIn({ ...withPlan, links: [{ personId: "22222222-2222-4222-8222-222222222222", planId: "p-other", linkedAt: "t", linkedBy: "x" }] }))).toBe(400);
    expect(buildCheckIn({ ...withPlan, links: [{ personId: PID, planId: "p-other", linkedAt: "t", linkedBy: "x" }] }).planId).toBe("p-other");
    expect(CheckInInput.safeParse({ kind: "ok", idempotencyKey: "k", note: "x".repeat(281) }).success).toBe(false);
  });
});

describe("attention", () => {
  const now = new Date("2026-10-17T00:00:00Z");
  const kinds = (items: { kind: string }[]) => items.map((i) => i.kind).sort();

  it("no schedule → never overdue; schedule → overdue with a stable window id", () => {
    expect(attentionFor({ person: person({ createdAt: "2020-01-01T00:00:00.000Z" }), plans: [], checkIns: [], ackedItemIds: [], now })).toEqual([]);
    const p = person({ checkInSchedule: { everyDays: 3 } });
    const items = attentionFor({ person: p, plans: [], checkIns: [ci({ at: "2026-10-13T00:00:00.000Z" })], ackedItemIds: [], now });
    expect(items.map((i) => i.itemId)).toEqual([`checkin_overdue:${PID}:2026-10-16T00:00:00.000Z`]);
    expect(attentionFor({ person: p, plans: [], checkIns: [ci({ at: "2026-10-15T00:00:00.000Z" })], ackedItemIds: [], now })).toEqual([]);
  });

  it("call: only the latest counts, cleared by a later ok from the same role; help always shows", () => {
    const p = person();
    const call1 = ci({ kind: "call", at: "2026-10-10T00:00:00.000Z" });
    const call2 = ci({ kind: "call", at: "2026-10-11T00:00:00.000Z" });
    let items = attentionFor({ person: p, plans: [], checkIns: [call1, call2], ackedItemIds: [], now });
    expect(items.map((i) => i.itemId)).toEqual([`call_requested:${call2.checkInId}`]);
    const selfOk = ci({ kind: "ok", reporterRole: "self", at: "2026-10-12T00:00:00.000Z" });
    expect(attentionFor({ person: p, plans: [], checkIns: [call1, call2, selfOk], ackedItemIds: [], now })).toHaveLength(1);
    const cgOk = ci({ kind: "ok", at: "2026-10-12T00:00:00.000Z" });
    expect(attentionFor({ person: p, plans: [], checkIns: [call1, call2, cgOk], ackedItemIds: [], now })).toEqual([]);
    const help = ci({ kind: "help" });
    items = attentionFor({ person: p, plans: [], checkIns: [help, cgOk], ackedItemIds: [`help_requested:${help.checkInId}`], now });
    expect(kinds(items)).toEqual(["help_requested"]);
    expect(items[0].acknowledgedByMe).toBe(true); // ack only marks, never removes
  });
});

describe("history pagination", () => {
  it("newest first, opaque cursor, no overlap", () => {
    const cs = Array.from({ length: 5 }, (_, i) => ci({ at: `2026-10-1${i}T00:00:00.000Z`, note: "private" }));
    const items = projectCheckins(cs, "cg-lee", ["view"]);
    const p1 = paginate(items, 2, null);
    expect(p1.items.map((i) => i.at)).toEqual(["2026-10-14T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]);
    expect(JSON.stringify(p1)).not.toContain("private");
    expect(p1.items[0].checkIn).toMatchObject({ hasNote: true });
    const p2 = paginate(items, 2, decodeCursor(p1.nextCursor!));
    const p3 = paginate(items, 2, decodeCursor(p2.nextCursor!));
    expect([...p1.items, ...p2.items, ...p3.items].map((i) => i.at)).toHaveLength(5);
    expect(p3.nextCursor).toBeNull();
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(projectCheckins(cs, "cg-dana", ["view"])[0].checkIn?.note).toBe("private"); // reporter sees own note
  });
});
