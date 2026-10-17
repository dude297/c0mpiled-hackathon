import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_PEOPLE, MAYA_CONTACTS, MAYA_PROFILE } from "@/domain/caregiver/fixtures";
import { currentActions } from "@/domain/coordination/coordinator";
import { coordinator } from "../coordination/_lib/service";
import { ports } from "./_lib/service";
import { POST as ackRoute } from "./attention/[itemId]/ack/route";
import { POST as demo } from "./demo/route";
import { GET as overviewRoute } from "./overview/route";
import { POST as createPersonRoute } from "./people/route";
import { GET as personRoute } from "./people/[id]/route";
import { GET as listGrantsRoute, POST as grantRoute } from "./people/[id]/grants/route";
import { DELETE as revokeRoute } from "./people/[id]/grants/[userId]/route";
import { POST as plansRoute } from "./people/[id]/plans/route";
import { POST as checkinRoute } from "./people/[id]/checkins/route";
import { GET as historyRoute } from "./people/[id]/history/route";

afterEach(() => vi.unstubAllEnvs());

const rq = (user: string | null, body?: unknown, url = "http://test/x", method = body === undefined ? "GET" : "POST") =>
  new Request(url, { method, headers: user ? { "x-daybridge-user": user } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const json = async (res: Response | Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (r.status === 204 ? null : await r.json()) as J };
};

const seed = async () => (await json(demo())).body as J;
const MAYA = DEMO_PEOPLE.maya;
const MARGARET = DEMO_PEOPLE.margaret;
const person = (user: string, id: string) => json(personRoute(rq(user), ctx({ id })));
const checkin = (user: string, id: string, body: unknown) => json(checkinRoute(rq(user, body), ctx({ id })));
const grant = (user: string, id: string, body: unknown) => json(grantRoute(rq(user, body), ctx({ id })));
const revoke = (user: string, id: string, target: string) => json(revokeRoute(rq(user, undefined, "http://test/x", "DELETE"), ctx({ id, userId: target })));
const history = (user: string, id: string, qs = "") => json(historyRoute(rq(user, undefined, `http://test/x${qs}`), ctx({ id })));
const overview = (user: string) => json(overviewRoute(rq(user)));
const ack = (user: string, itemId: string) => json(ackRoute(rq(user, {}), ctx({ itemId })));

describe("caregiver API: identity, fixtures, isolation", () => {
  it("requires a valid caller header (401) and labels every response", async () => {
    expect((await overview("")).status).toBe(401);
    expect((await json(overviewRoute(rq("Not Valid!")))).status).toBe(401);
    const ok = await overview("cg-nobody");
    expect(ok.status).toBe(200);
    expect(ok.body.labels).toMatchObject({ storage: "memory", providers: "simulated" });
    expect(ok.body.people).toEqual([]);
  });

  it("seeds fixtures: Maya AWAITING_APPROVAL + overdue, Margaret READY, no schedule → no overdue", async () => {
    const s = await seed();
    expect(s.people.maya.state).toBe("AWAITING_APPROVAL");
    expect(s.people.margaret.state).toBe("READY");
    const dana = await overview("cg-dana");
    const byName = Object.fromEntries(dana.body.people.map((p: J) => [p.displayName, p]));
    expect(Object.keys(byName).sort()).toEqual(["Margaret", "Maya"]);
    expect(byName.Maya.timezone).toBe("America/Los_Angeles");
    expect(byName.Maya.nextActivity).toMatchObject({ activityName: "Sunday Fellowship Lunch", slot: "Sun afternoon", state: "AWAITING_APPROVAL" });
    expect(byName.Maya.latestCheckIn).toMatchObject({ kind: "ok", reporterRole: "caregiver" });
    const maya = await person("cg-dana", MAYA);
    expect(maya.body.attention.map((i: J) => i.kind).sort()).toEqual(["approval_needed", "checkin_overdue"]);
    const margaret = await person("cg-dana", MARGARET);
    expect(margaret.body.attention).toEqual([]);
    expect(margaret.body.plans[0]).toMatchObject({ state: "READY", dependencies: [] });
  });

  it("isolation: cg-lee sees only Margaret; Maya is a 404 (no existence leak)", async () => {
    await seed();
    const lee = await overview("cg-lee");
    expect(lee.body.people.map((p: J) => p.displayName)).toEqual(["Margaret"]);
    expect(lee.body.people[0].myScopes).toEqual(["view"]);
    expect((await person("cg-lee", MAYA)).status).toBe(404);
    expect((await history("cg-lee", MAYA)).status).toBe(404);
    expect((await person("cg-lee", "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await person("cg-lee", MAYA)).body.error).toBe((await person("cg-lee", "00000000-0000-4000-8000-000000000000")).body.error);
    // self-maya has no grant: can check in, cannot view
    expect((await person("self-maya", MAYA)).status).toBe(404);
    expect((await overview("self-maya")).body.people).toEqual([]);
  });
});

describe("caregiver API: scoped writes and grants", () => {
  it("viewer cannot check in or manage (403); checkin scope cannot grant", async () => {
    await seed();
    expect((await checkin("cg-lee", MARGARET, { kind: "ok", idempotencyKey: "k1" })).status).toBe(403);
    expect((await grant("cg-lee", MARGARET, { userId: "cg-kim", scopes: ["view"] })).status).toBe(403);
    expect((await json(listGrantsRoute(rq("cg-lee"), ctx({ id: MARGARET })))).status).toBe(403);
    expect((await revoke("cg-lee", MARGARET, "cg-dana")).status).toBe(403);
    expect((await json(plansRoute(rq("cg-lee", { activityId: "bridge" }), ctx({ id: MARGARET })))).status).toBe(403);

    expect((await grant("cg-dana", MARGARET, { userId: "cg-sam", scopes: ["checkin", "checkin"] })).body.scopes).toEqual(["checkin"]);
    expect((await checkin("cg-sam", MARGARET, { kind: "ok", idempotencyKey: "sam-1" })).status).toBe(201);
    expect((await grant("cg-sam", MARGARET, { userId: "cg-kim", scopes: ["view"] })).status).toBe(403);
    expect((await person("cg-sam", MARGARET)).status).toBe(403); // has a grant, lacks view
    expect((await grant("cg-dana", MARGARET, { userId: "cg-kim", scopes: [] })).status).toBe(400);
    expect((await json(listGrantsRoute(rq("cg-dana"), ctx({ id: MARGARET })))).body.grants.map((g: J) => g.userId).sort()).toEqual(["cg-dana", "cg-lee", "cg-sam"]);
  });

  it("revocation is immediate; the last manager cannot be removed (409)", async () => {
    await seed();
    expect((await grant("cg-dana", MAYA, { userId: "cg-lee", scopes: ["view"] })).status).toBe(201);
    expect((await person("cg-lee", MAYA)).status).toBe(200);
    expect((await revoke("cg-dana", MAYA, "cg-lee")).status).toBe(204);
    expect((await person("cg-lee", MAYA)).status).toBe(404);
    expect((await revoke("cg-dana", MAYA, "cg-lee")).status).toBe(404);
    expect((await revoke("cg-dana", MAYA, "cg-dana")).status).toBe(409);
    expect((await grant("cg-dana", MAYA, { userId: "cg-dana", scopes: ["view"] })).status).toBe(409);
  });

  it("creates a person: caller becomes manager; bad bodies are 400", async () => {
    const made = await json(createPersonRoute(rq("cg-new", { profile: MAYA_PROFILE, timezone: "Pacific/Kiritimati" })));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ timezone: "Pacific/Kiritimati", checkInSchedule: null, createdBy: "cg-new" });
    expect((await overview("cg-new")).body.people[0].myScopes.sort()).toEqual(["checkin", "manage", "view"]);
    expect((await json(createPersonRoute(rq("cg-new", { profile: MAYA_PROFILE, timezone: "Nowhere/Land" })))).status).toBe(400);
    expect((await json(createPersonRoute(rq("cg-new", { timezone: "UTC" })))).status).toBe(400);
  });
});

describe("caregiver API: plans and check-ins", () => {
  it("safe plan association: plans only via the person endpoint; a body planId is ignored; foreign planIds are rejected", async () => {
    const s = await seed();
    const mayaPlan = s.people.maya.planId;
    const made = await json(plansRoute(rq("cg-dana", { activityId: "bridge", planId: mayaPlan }), ctx({ id: MARGARET })));
    expect(made.status).toBe(201);
    expect(made.body.planId).not.toBe(mayaPlan);
    expect(await ports.store.linkPlan({ personId: MARGARET, planId: mayaPlan, linkedAt: "t", linkedBy: "cg-dana" })).toBe("already_linked");
    expect((await ports.store.getPlanLink(mayaPlan))?.personId).toBe(MAYA);
    expect((await checkin("cg-dana", MARGARET, { kind: "ok", planId: mayaPlan, idempotencyKey: "x" })).status).toBe(400);
    expect((await json(plansRoute(rq("cg-dana", { activityId: "no-such" }), ctx({ id: MARGARET })))).status).toBe(400);
    expect((await person("cg-dana", MARGARET)).body.plans).toHaveLength(2);
  });

  it("duplicate check-ins: same key → 200 duplicate with the original; different body → 409", async () => {
    await seed();
    const body = { kind: "call", note: "Please ring after lunch", idempotencyKey: "dup-1" };
    const a = await checkin("cg-dana", MAYA, body);
    const b = await checkin("cg-dana", MAYA, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.checkIn.checkInId).toBe(a.body.checkIn.checkInId);
    expect((await checkin("cg-dana", MAYA, { ...body, kind: "help" })).status).toBe(409);
    expect((await checkin("cg-dana", MAYA, { kind: "nope", idempotencyKey: "z" })).status).toBe(400);
    const self = await checkin("self-maya", MAYA, { kind: "ok", idempotencyKey: "dup-1" });
    expect(self.status).toBe(201);
    expect(self.body.checkIn.reporterRole).toBe("self");
  });

  it("a check-in never changes plan state or version", async () => {
    const s = await seed();
    const planId = s.people.maya.planId;
    const before = await coordinator.get(planId);
    for (const kind of ["ok", "call", "help"]) expect((await checkin("cg-dana", MAYA, { kind, planId, idempotencyKey: `nt-${kind}` })).status).toBe(201);
    const after = await coordinator.get(planId);
    expect(after.plan.state).toBe(before.plan.state);
    expect(after.plan.version).toBe(before.plan.version);
    expect(after.events).toHaveLength(before.events.length);
    expect(after.plan.outcome).toBeUndefined();
  });

  it("acks mark only acknowledgedByMe; the item stays and the coordinator is unchanged", async () => {
    const s = await seed();
    const planId = s.people.maya.planId;
    const before = await coordinator.get(planId);
    const item = (await person("cg-dana", MAYA)).body.attention.find((i: J) => i.kind === "approval_needed");
    expect(item.acknowledgedByMe).toBe(false);
    expect(await ack("cg-dana", item.itemId)).toMatchObject({ status: 200, body: { itemId: item.itemId, acknowledgedByMe: true } });
    const again = (await person("cg-dana", MAYA)).body.attention.find((i: J) => i.itemId === item.itemId);
    expect(again.acknowledgedByMe).toBe(true);
    const after = await coordinator.get(planId);
    expect([after.plan.state, after.plan.version, after.events.length]).toEqual([before.plan.state, before.plan.version, before.events.length]);
    expect((await ack("cg-lee", item.itemId)).status).toBe(404); // no access to Maya
    expect((await ack("cg-dana", `approval_needed:${planId}:v99`)).status).toBe(404);
    // help item ack
    const h = await checkin("cg-dana", MAYA, { kind: "help", idempotencyKey: "help-1" });
    expect((await ack("cg-dana", `help_requested:${h.body.checkIn.checkInId}`)).status).toBe(200);
    expect((await person("cg-dana", MAYA)).body.attention.some((i: J) => i.kind === "help_requested")).toBe(true);
  });

  it("notes: visible to the reporter and managers only", async () => {
    await seed();
    await grant("cg-dana", MARGARET, { userId: "cg-sam", scopes: ["checkin", "view"] });
    await checkin("cg-sam", MARGARET, { kind: "ok", note: "Secret note from Sam", idempotencyKey: "n1" });
    const lee = JSON.stringify((await history("cg-lee", MARGARET)).body) + JSON.stringify((await person("cg-lee", MARGARET)).body);
    expect(lee).not.toContain("Secret note");
    expect((await person("cg-lee", MARGARET)).body.latestCheckIns[0]).toMatchObject({ hasNote: true });
    expect(JSON.stringify((await history("cg-dana", MARGARET)).body)).toContain("Secret note"); // manager
    expect(JSON.stringify((await history("cg-sam", MARGARET)).body)).toContain("Secret note"); // reporter
  });

  it("history pagination: limit capped at 50, opaque cursor, bad cursor 400", async () => {
    await seed();
    for (let i = 0; i < 4; i++) await checkin("cg-dana", MARGARET, { kind: "ok", idempotencyKey: `pg-${i}` });
    const all = (await history("cg-dana", MARGARET, "?limit=999")).body.items;
    const p1 = await history("cg-dana", MARGARET, "?limit=2");
    const p2 = await history("cg-dana", MARGARET, `?limit=2&cursor=${p1.body.nextCursor}`);
    expect([...p1.body.items, ...p2.body.items]).toEqual(all.slice(0, 4));
    expect((await history("cg-dana", MARGARET, "?cursor=%%%")).status).toBe(400);
    expect((await history("cg-dana", MARGARET, "?limit=0")).status).toBe(400);
  });
});

describe("caregiver API: agreement with the coordinator through the golden flow", () => {
  it("dashboard state equals coordinator state after every step; statuses stay distinct; no restricted data", async () => {
    const U = "cg-golden";
    const id = (await json(createPersonRoute(rq(U, { profile: MAYA_PROFILE, timezone: "America/Los_Angeles" })))).body.personId;
    const planId = (await json(plansRoute(rq(U, { activityId: "fellowship", contacts: MAYA_CONTACTS }), ctx({ id })))).body.planId;
    const seq = new Map<string, number>();
    const rawIds = new Set<string>();

    const check = async (expected: string, attentionKind?: string) => {
      const truth = (await coordinator.get(planId)).plan;
      for (const a of truth.actions) rawIds.add(a.id);
      const d = await person(U, id);
      const summary = d.body.plans.find((p: J) => p.planId === planId);
      expect(truth.state).toBe(expected);
      expect(summary.state).toBe(truth.state);
      expect(summary.version).toBe(truth.version);
      const o = (await overview(U)).body.people.find((p: J) => p.personId === id);
      if (expected === "COMPLETED") expect(o.nextActivity).toBeNull();
      else expect(o.nextActivity.state).toBe(truth.state);
      if (attentionKind) expect(d.body.attention.map((i: J) => i.kind)).toContain(attentionKind);
      return { truth, summary };
    };
    const approveAll = async () => {
      const p = (await coordinator.get(planId)).plan;
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      for (const a of currentActions(p).filter((x) => x.status === "proposed")) await coordinator.command(planId, { type: "approve", actionId: a.id, scope: a.scope, expiresAt });
    };
    const event = async (kind: "ride" | "invite", type: "ride.confirmed" | "ride.cancelled" | "invite.accepted") => {
      const a = currentActions((await coordinator.get(planId)).plan).find((x) => x.scope.kind === kind)!;
      const n = (seq.get(a.providerRequestId!) ?? 0) + 1;
      seq.set(a.providerRequestId!, n);
      await coordinator.ingest(planId, { eventId: crypto.randomUUID(), requestId: a.providerRequestId!, sequence: n, type, actor: "demo" });
    };

    await check("PROPOSED");
    await coordinator.command(planId, { type: "accept_proposal" });
    const awaiting = await check("AWAITING_APPROVAL", "approval_needed");
    expect(awaiting.summary.outstandingApprovals.length).toBeGreaterThan(0);
    await approveAll();
    await check("AWAITING_APPROVAL");
    await coordinator.command(planId, { type: "execute" });
    const pending = await check("PENDING_CONFIRMATION", "confirmation_pending");
    expect(pending.summary.dependencies.every((d: J) => d.status === "requested")).toBe(true);
    await event("invite", "invite.accepted");
    const half = await check("PENDING_CONFIRMATION");
    expect(half.summary.dependencies.map((d: J) => d.status).sort()).toEqual(["confirmed", "requested"]); // requested ≠ confirmed
    await event("ride", "ride.confirmed");
    await check("READY");
    await event("ride", "ride.cancelled");
    const disrupted = await check("NEEDS_REPLAN", "plan_disrupted");
    expect(disrupted.summary.dependencies.find((d: J) => d.kind === "invite").status).toBe("confirmed");
    await coordinator.command(planId, { type: "accept_proposal" });
    await check("AWAITING_APPROVAL", "approval_needed");
    await approveAll();
    await coordinator.command(planId, { type: "execute" });
    await check("PENDING_CONFIRMATION");
    await event("ride", "ride.confirmed");
    const ready = await check("READY");
    expect(ready.summary.outcome).toBeUndefined(); // confirmed ≠ attended
    await coordinator.command(planId, { type: "complete", attended: true });
    const done = await check("COMPLETED");
    expect(done.summary.outcome).toEqual({ attended: true, source: "self_reported" });
    expect(done.summary.dependencies.every((d: J) => d.status === "confirmed")).toBe(true); // attendance is not a dependency status
    await coordinator.command(planId, { type: "feedback", signals: ["too_far"] });
    const patch = (await coordinator.get(planId)).plan.preferencePatches[0];
    await coordinator.command(planId, { type: "confirm_preference", patchId: patch.id });

    const h = await history(U, id, "?limit=50");
    const types = h.body.items.map((i: J) => `${i.type}:${i.summary}`);
    expect(types).toContain("plan_state:Plan is ready");
    expect(types).toContain("plan_state:Plan is no longer ready");
    expect(types).toContain("plan_state:Plan needs a new arrangement");
    expect(types).toContain("dependency:Ride: requested");
    expect(types).toContain("dependency:Ride: confirmed");
    expect(types).toContain("dependency:Ride: cancelled");
    expect(types).toContain("dependency:Invite: confirmed");
    expect(types).toContain("attendance:Attended (self-reported)");
    expect(types).toContain("feedback:Preferences updated from feedback");
    expect(h.body.items[0].at >= h.body.items.at(-1).at).toBe(true);

    // Restricted data: scan the raw JSON of history and person detail.
    const text = JSON.stringify(h.body) + JSON.stringify((await person(U, id)).body);
    for (const banned of ["sharedFields", "requestId", "approvalId", "idempotencyKey", "providerRequestId", "Elaine", "Dan", "elaine", "mock-", ":approval:", "token", "scope"])
      expect(text, banned).not.toContain(banned);
    for (const raw of rawIds) expect(text).not.toContain(raw);
  });
});

describe("caregiver API: hosted fail-closed", () => {
  it("NODE_ENV=production without the local-demo flag → 503 on every route", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const p = ctx({ id: MAYA });
    const results = await Promise.all([
      overviewRoute(rq("cg-dana")),
      createPersonRoute(rq("cg-dana", { profile: MAYA_PROFILE, timezone: "UTC" })),
      personRoute(rq("cg-dana"), p),
      grantRoute(rq("cg-dana", { userId: "cg-lee", scopes: ["view"] }), p),
      listGrantsRoute(rq("cg-dana"), p),
      revokeRoute(rq("cg-dana", undefined, "http://test/x", "DELETE"), ctx({ id: MAYA, userId: "cg-lee" })),
      plansRoute(rq("cg-dana", { activityId: "bridge" }), p),
      checkinRoute(rq("cg-dana", { kind: "ok", idempotencyKey: "h" }), p),
      historyRoute(rq("cg-dana"), p),
      ackRoute(rq("cg-dana", {}), ctx({ itemId: "x" })),
      demo(),
      overviewRoute(rq(null)), // even without a caller: 503 before 401
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(503));
    expect(((await results[0].json()) as J).error).toMatch(/local demo/);
    vi.stubEnv("DAYBRIDGE_DEMO_EVENTS", "1");
    expect((await overviewRoute(rq("cg-dana"))).status).toBe(200);
  });
});
