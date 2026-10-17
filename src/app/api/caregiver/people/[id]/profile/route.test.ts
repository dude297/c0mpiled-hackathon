import { describe, expect, it } from "vitest";
import { DEMO_PEOPLE } from "@/domain/caregiver/fixtures";
import { coordinator } from "../../../../coordination/_lib/service";
import { POST as demo } from "../../../demo/route";
import { POST as plansRoute } from "../plans/route";
import { POST as feedbackRoute } from "../plans/[planId]/feedback-proposals/route";
import { GET as profileRoute } from "./route";
import { GET as versionsRoute } from "./versions/route";
import { GET as listProposalsRoute, POST as proposeRoute } from "./proposals/route";
import { POST as confirmRoute } from "./proposals/[pid]/confirm/route";
import { POST as rejectRoute } from "./proposals/[pid]/reject/route";
import { POST as revertRoute } from "./revert/route";
import { POST as grantRoute } from "../grants/route";

const rq = (user: string, body?: unknown, url = "http://test/x") =>
  new Request(url, { method: body === undefined ? "GET" : "POST", headers: { "x-daybridge-user": user }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const json = async (res: Promise<Response>) => {
  const r = await res;
  return { status: r.status, body: (await r.json()) as J };
};

const MAYA: string = DEMO_PEOPLE.maya;
const MARGARET: string = DEMO_PEOPLE.margaret;
const seed = async () => (await json(demo())).body as J;
const profile = (u: string, id = MAYA) => json(profileRoute(rq(u), ctx({ id })));
const versions = (u: string, id = MAYA, qs = "") => json(versionsRoute(rq(u, undefined, `http://test/x${qs}`), ctx({ id })));
const proposals = (u: string, id = MAYA, qs = "") => json(listProposalsRoute(rq(u, undefined, `http://test/x${qs}`), ctx({ id })));
const propose = (u: string, b: unknown, id = MAYA) => json(proposeRoute(rq(u, b), ctx({ id })));
const confirm = (u: string, pid: string, b: unknown, id = MAYA) => json(confirmRoute(rq(u, b), ctx({ id, pid })));
const reject = (u: string, pid: string, id = MAYA) => json(rejectRoute(rq(u, {}), ctx({ id, pid })));
const revert = (u: string, b: unknown, id = MAYA) => json(revertRoute(rq(u, b), ctx({ id })));
const feedback = (u: string, id: string, planId: string) => json(feedbackRoute(rq(u, {}), ctx({ id, planId })));
const grant = (u: string, id: string, b: unknown) => json(grantRoute(rq(u, b), ctx({ id })));

const P = (changes: object, baseVersion = 1, evidence = "Said the drive was tiring") => ({ changes, evidence, baseVersion });

describe("person profiles: proposals, confirm, stale, revert", () => {
  it("seeded people start at version 1 with a create entry", async () => {
    await seed();
    const p = await profile("cg-dana");
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ version: 1, profile: { name: "Maya", maxTravelMin: 30 }, labels: { storage: "memory" } });
    expect((await versions("cg-dana")).body.items).toMatchObject([{ version: 1, source: "create" }]);
  });

  it("a proposal never changes the profile until it is confirmed", async () => {
    await seed();
    const made = await propose("cg-dana", P({ maxTravelMin: 15, mobility: "walker" }));
    expect(made.status).toBe(201);
    expect(made.body.proposal).toMatchObject({ status: "proposed", baseVersion: 1, changes: { maxTravelMin: 15 }, source: "caregiver" });
    expect(made.body.proposal.changes).not.toHaveProperty("mobility"); // no-op dropped
    expect((await profile("cg-dana")).body).toMatchObject({ version: 1, profile: { maxTravelMin: 30 } });
    expect((await versions("cg-dana")).body.items).toHaveLength(1);
    expect((await proposals("cg-dana", MAYA, "?status=proposed")).body.proposals).toHaveLength(1);

    const ok = await confirm("cg-dana", made.body.proposal.proposalId, { expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ version: 2, profile: { maxTravelMin: 15 }, proposal: { status: "confirmed", decidedBy: "cg-dana" } });
    expect((await profile("cg-dana")).body).toMatchObject({ version: 2, profile: { maxTravelMin: 15 } });
    expect((await versions("cg-dana")).body.items[0]).toMatchObject({ version: 2, source: "caregiver", proposalId: made.body.proposal.proposalId });
    // already decided → 409
    expect((await confirm("cg-dana", made.body.proposal.proposalId, { expectedVersion: 2 })).status).toBe(409);
  });

  it("two proposals from the same base: first confirm wins, second → 409 stale", async () => {
    await seed();
    const a = (await propose("cg-dana", P({ maxTravelMin: 20 }))).body.proposal;
    const b = (await propose("cg-dana", P({ budgetPerWeek: 5 }))).body.proposal;
    const [ra, rb] = await Promise.all([confirm("cg-dana", a.proposalId, { expectedVersion: 1 }), confirm("cg-dana", b.proposalId, { expectedVersion: 1 })]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(409);
    expect(rb.body.status).toBe("stale");
    const list = (await proposals("cg-dana")).body.proposals;
    expect(list.find((p: J) => p.proposalId === b.proposalId).status).toBe("stale");
    expect((await profile("cg-dana")).body).toMatchObject({ version: 2, profile: { maxTravelMin: 20, budgetPerWeek: 10 } });
    // proposing against an old base is refused up front
    expect((await propose("cg-dana", P({ budgetPerWeek: 5 }, 1))).status).toBe(409);
    // expectedVersion mismatch on a fresh proposal → 409, proposal stays open
    const c = (await propose("cg-dana", P({ budgetPerWeek: 5 }, 2))).body.proposal;
    expect((await confirm("cg-dana", c.proposalId, { expectedVersion: 1 })).status).toBe(409);
    expect((await confirm("cg-dana", c.proposalId, { expectedVersion: 2 })).status).toBe(200);
  });

  it("reject leaves the profile alone", async () => {
    await seed();
    const a = (await propose("cg-dana", P({ hearingImpaired: true }))).body.proposal;
    expect((await reject("cg-dana", a.proposalId)).body.proposal.status).toBe("rejected");
    expect((await profile("cg-dana")).body).toMatchObject({ version: 1, profile: { hearingImpaired: false } });
  });

  it("revert appends a new version; history keeps every version (newest first, paginated)", async () => {
    await seed();
    const a = (await propose("cg-dana", P({ maxTravelMin: 15 }))).body.proposal;
    await confirm("cg-dana", a.proposalId, { expectedVersion: 1 });
    expect((await revert("cg-dana", { toVersion: 1, expectedVersion: 1 })).status).toBe(409);
    expect((await revert("cg-dana", { toVersion: 9, expectedVersion: 2 })).status).toBe(404);
    const r = await revert("cg-dana", { toVersion: 1, expectedVersion: 2 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ version: 3, revertedTo: 1, profile: { maxTravelMin: 30 } });
    const all = (await versions("cg-dana")).body.items;
    expect(all.map((v: J) => [v.version, v.source, v.profile.maxTravelMin])).toEqual([[3, "revert", 30], [2, "caregiver", 15], [1, "create", 30]]);
    const p1 = await versions("cg-dana", MAYA, "?limit=2");
    const p2 = await versions("cg-dana", MAYA, `?limit=2&cursor=${p1.body.nextCursor}`);
    expect([...p1.body.items, ...p2.body.items]).toEqual(all);
    expect(p2.body.nextCursor).toBeNull();
    expect((await versions("cg-dana", MAYA, "?cursor=abc")).status).toBe(400);
    expect((await versions("cg-dana", MAYA, "?limit=0")).status).toBe(400);
  });

  it("validation: unknown fields, bad enum values, empty or no-op changes → 400", async () => {
    await seed();
    expect((await propose("cg-dana", P({ mobility: "jetpack" }))).status).toBe(400);
    expect((await propose("cg-dana", P({ interests: ["faith", "skydiving"] }))).status).toBe(400);
    expect((await propose("cg-dana", P({ maxTravelMin: 999 }))).status).toBe(400);
    expect((await propose("cg-dana", P({ selfUserId: "cg-evil" }))).status).toBe(400);
    expect((await propose("cg-dana", P({}))).status).toBe(400);
    expect((await propose("cg-dana", P({ maxTravelMin: 30 }))).status).toBe(400); // equals current
    expect((await propose("cg-dana", P({ maxTravelMin: 15 }, 1, "x".repeat(281)))).status).toBe(400);
    expect((await propose("cg-dana", { ...P({ maxTravelMin: 15 }), source: "self" })).status).toBe(400); // not the person
    expect((await propose("cg-dana", { ...P({ maxTravelMin: 15 }), source: "feedback" })).status).toBe(400);
    expect((await confirm("cg-dana", "nope", { expectedVersion: 1 })).status).toBe(404);
    expect((await profile("cg-dana")).body.version).toBe(1);
  });
});

describe("person profiles: scopes and isolation", () => {
  it("viewer reads but cannot propose; checkin proposes but cannot confirm/revert; self proposes and confirms own", async () => {
    await seed();
    await grant("cg-dana", MAYA, { userId: "cg-view", scopes: ["view"] });
    await grant("cg-dana", MAYA, { userId: "cg-chk", scopes: ["checkin"] });
    expect((await profile("cg-view")).status).toBe(200);
    expect((await propose("cg-view", P({ maxTravelMin: 15 }))).status).toBe(403);
    expect((await profile("cg-chk")).status).toBe(403); // checkin alone cannot read

    const c = await propose("cg-chk", P({ maxTravelMin: 15 }));
    expect(c.status).toBe(201);
    expect((await confirm("cg-chk", c.body.proposal.proposalId, { expectedVersion: 1 })).status).toBe(403);
    expect((await reject("cg-chk", c.body.proposal.proposalId)).status).toBe(403);
    expect((await revert("cg-chk", { toVersion: 1, expectedVersion: 1 })).status).toBe(403);
    expect((await confirm("cg-view", c.body.proposal.proposalId, { expectedVersion: 1 })).status).toBe(403);

    // self-maya (no grant) can read her own profile and confirm a caregiver's proposal
    expect((await profile("self-maya")).status).toBe(200);
    expect((await confirm("self-maya", c.body.proposal.proposalId, { expectedVersion: 1 })).status).toBe(200);
    const s = await propose("self-maya", P({ times: ["morning", "afternoon"] }, 2, "I like mornings now"));
    expect(s.body.proposal).toMatchObject({ source: "self", proposedBy: "self-maya" });
    expect((await confirm("self-maya", s.body.proposal.proposalId, { expectedVersion: 2 })).body.version).toBe(3);
    expect((await revert("self-maya", { toVersion: 1, expectedVersion: 3 })).status).toBe(403);
  });

  it("cross-person isolation: no grant → 404; a proposal id from another person → 404", async () => {
    await seed();
    expect((await profile("cg-lee", MAYA)).status).toBe(404);
    expect((await versions("cg-lee", MAYA)).status).toBe(404);
    expect((await propose("cg-lee", P({ maxTravelMin: 15 }), MAYA)).status).toBe(404);
    expect((await profile("self-maya", MARGARET)).status).toBe(404);
    expect((await propose("self-maya", P({ maxTravelMin: 15 }), MARGARET)).status).toBe(404);
    const m = (await propose("cg-dana", P({ maxTravelMin: 15 }), MAYA)).body.proposal;
    expect((await confirm("cg-dana", m.proposalId, { expectedVersion: 1 }, MARGARET)).status).toBe(404);
    expect((await profile("cg-dana", MAYA)).body.version).toBe(1);
  });
});

describe("person profiles: feedback import and plan creation", () => {
  it("imports a linked COMPLETED plan's feedback patches as a proposal only; plan unchanged", async () => {
    const s = await seed();
    const planId = s.people.margaret.planId;
    expect((await feedback("cg-dana", MARGARET, planId)).status).toBe(409); // READY, not completed
    await coordinator.command(planId, { type: "complete", attended: true });
    await coordinator.command(planId, { type: "feedback", signals: ["too_far", "too_expensive"] });
    const before = await coordinator.get(planId);

    expect((await feedback("cg-lee", MARGARET, planId)).status).toBe(403); // view only
    expect((await feedback("cg-dana", MAYA, planId)).status).toBe(404); // not Maya's plan
    expect((await feedback("cg-dana", MARGARET, "no-such-plan")).status).toBe(404);

    const r = await feedback("cg-dana", MARGARET, planId);
    expect(r.status).toBe(201);
    const [prop] = r.body.proposals;
    expect(prop).toMatchObject({ source: "feedback", status: "proposed", planId, baseVersion: 1 });
    expect(Object.keys(prop.changes).sort()).toEqual(["budgetPerWeek", "maxTravelMin"]);
    expect((await feedback("cg-dana", MARGARET, planId)).body).toMatchObject({ duplicate: true, proposals: [{ proposalId: prop.proposalId }] });
    expect((await profile("cg-dana", MARGARET)).body.version).toBe(1);
    const after = await coordinator.get(planId);
    expect(after.plan).toEqual(before.plan);
    expect(after.events).toHaveLength(before.events.length);

    const ok = await confirm("cg-dana", prop.proposalId, { expectedVersion: 1 }, MARGARET);
    expect(ok.body.version).toBe(2);
    expect((await versions("cg-dana", MARGARET)).body.items[0]).toMatchObject({ source: "feedback" });
  });

  it("new plans use the current profile version and record it on the link", async () => {
    await seed();
    const a = (await propose("cg-dana", P({ maxTravelMin: 15 }))).body.proposal;
    await confirm("cg-dana", a.proposalId, { expectedVersion: 1 });
    const made = await json(plansRoute(rq("cg-dana", { activityId: "fellowship" }), ctx({ id: MAYA })));
    expect(made.status).toBe(201);
    expect(made.body.profileVersion).toBe(2);
    const { plan } = await coordinator.get(made.body.planId);
    expect(plan.profile.maxTravelMin).toBe(15);
  });

  it("responses carry no tokens, contact data, or notes", async () => {
    const s = await seed();
    const a = (await propose("cg-dana", P({ maxTravelMin: 15 }))).body.proposal;
    await confirm("cg-dana", a.proposalId, { expectedVersion: 1 });
    await coordinator.command(s.people.margaret.planId, { type: "complete", attended: true });
    await coordinator.command(s.people.margaret.planId, { type: "feedback", signals: ["too_far"] });
    const text = JSON.stringify([
      (await profile("cg-dana")).body, (await versions("cg-dana")).body, (await proposals("cg-dana")).body,
      (await feedback("cg-dana", MARGARET, s.people.margaret.planId)).body,
    ]);
    for (const bad of ["token", "idempotencyKey", "requestId", "approvalId", "sharedFields", "Elaine", "elaine", "Dan (", "\"dan\"", "contacts", "note"]) expect(text).not.toContain(bad);
  });
});
