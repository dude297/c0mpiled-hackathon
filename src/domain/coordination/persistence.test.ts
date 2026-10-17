import { describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activities";
import { CommandResult, type CoordinationPlan, type Contact, type Profile } from "@/lib/schema";
import { createCoordinator, currentActions, currentDeps, readyViolations, type Coordinator } from "./coordinator";
import { createMockProvider } from "./provider";
import { createMemoryStore, type CoordinationStore } from "./store";

// Store-backed coordinator: every coordinator instance here stands in for a separate server process
// sharing one database (the memory store has the same CAS semantics as the Supabase store).
const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];
const T0 = Date.parse("2026-10-17T12:00:00Z");
const HOUR = 3600_000;
const at = (ms: number) => new Date(T0 + ms).toISOString();
const ok = (r: CommandResult) => CommandResult.parse(r);

let ids = 0;
const newId = () => `plan-${++ids}`;
const provider = createMockProvider(); // one external provider shared by all "processes"
const make = (store: CoordinationStore) => createCoordinator({ provider, store, now: () => new Date(T0), activities: [WORKSHOP], newId });

const pending = (p: CoordinationPlan) => currentActions(p).filter((a) => a.status === "proposed" || a.status === "revoked");
const approve = (c: Coordinator, id: string, a: CoordinationPlan["actions"][number], owner?: string | null) =>
  c.command(id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: at(HOUR) }, owner);
const seqsOf = async (store: CoordinationStore, id: string) => (await store.load(id))!.log.map((e) => e.seq);
const contiguous = (seqs: number[]) => seqs.every((s, i) => s === i + 1);

async function toAwaitingApproval(c: Coordinator, owner?: string | null) {
  const id = ok(await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }, owner)).plan.id;
  expect(ok(await c.command(id, { type: "accept_proposal" }, owner)).plan.state).toBe("AWAITING_APPROVAL");
  return id;
}

async function confirmAll(c: Coordinator, id: string, owner?: string | null) {
  const p = (await c.get(id, owner)).plan;
  for (const a of currentActions(p)) {
    ok(await c.ingest(id, { eventId: `${a.id}:ok`, requestId: a.providerRequestId!, sequence: 1, type: a.scope.kind === "ride" ? "ride.confirmed" : "invite.accepted", actor: "demo" }, owner));
  }
  return (await c.get(id, owner)).plan;
}

describe("store-backed coordinator", () => {
  it("(a) a new coordinator over the same store loads and continues a plan", async () => {
    const store = createMemoryStore();
    const id = await toAwaitingApproval(make(store));
    const b = make(store); // "restarted server"
    const { plan, events } = await b.get(id);
    expect(plan.state).toBe("AWAITING_APPROVAL");
    expect(events.length).toBeGreaterThan(0);
    for (const a of pending(plan)) expect(ok(await approve(b, id, a)).outcome).toBe("applied");
    expect((await store.load(id))!.rev).toBe(2 + pending(plan).length);
    expect(contiguous(await seqsOf(store, id))).toBe(true);
  });

  it("(b) a lost CAS race reloads and reruns: both writers' effects survive, no duplicate seq", async () => {
    const inner = createMemoryStore();
    const other = make(inner);
    const id = await toAwaitingApproval(other);
    const [first, second] = pending((await other.get(id)).plan);
    expect(second).toBeDefined();
    let raced = false;
    const racy: CoordinationStore = {
      ...inner,
      kind: inner.kind,
      async commit(...args) {
        if (!raced) {
          raced = true;
          ok(await approve(other, id, second)); // another instance commits first
        }
        return inner.commit(...args);
      },
    };
    const r = ok(await approve(make(racy), id, first));
    expect(r.outcome).toBe("applied");
    const stored = (await inner.load(id))!;
    expect(stored.plan.approvals.map((x) => x.actionId).sort()).toEqual([first.id, second.id].sort());
    expect(contiguous(stored.log.map((e) => e.seq))).toBe(true);
    expect(stored.log.filter((e) => e.type === "action.approved")).toHaveLength(2);
  });

  it("(c) a store that always conflicts yields 409 and changes nothing", async () => {
    const inner = createMemoryStore();
    const id = await toAwaitingApproval(make(inner));
    const before = await inner.load(id);
    let commits = 0;
    const stuck: CoordinationStore = { ...inner, kind: inner.kind, commit: async () => (commits++, false) };
    await expect(make(stuck).command(id, { type: "cancel" })).rejects.toMatchObject({ status: 409 });
    expect(commits).toBe(3);
    expect(await inner.load(id)).toEqual(before);
  });

  it("(d) a provider event is processed once even across instances", async () => {
    const store = createMemoryStore();
    const a = make(store);
    const id = await toAwaitingApproval(a);
    for (const x of pending((await a.get(id)).plan)) ok(await approve(a, id, x));
    ok(await a.command(id, { type: "execute" }));
    const ride = currentActions((await a.get(id)).plan).find((x) => x.scope.kind === "ride")!;
    const ev = { eventId: "dup-1", requestId: ride.providerRequestId!, sequence: 1, type: "ride.confirmed" as const, actor: "demo" as const };
    expect(ok(await a.ingest(id, ev)).outcome).toBe("applied");
    const again = ok(await make(store).ingest(id, ev));
    expect(again.outcome).toBe("duplicate");
    const log = (await store.load(id))!.log.filter((e) => (e.payload as { eventId?: string }).eventId === "dup-1");
    expect(log.map((e) => e.outcome)).toEqual(["applied", "duplicate"]);
  });

  it("(e) a wrong owner gets the same 404 as a missing plan", async () => {
    const store = createMemoryStore();
    const c = make(store);
    const id = await toAwaitingApproval(c, "alice");
    const before = await store.load(id);
    expect(before!.ownerId).toBe("alice");
    const missing = await c.get("nope", "alice").catch((e) => e);
    for (const owner of ["mallory", null, undefined]) {
      const errs = await Promise.all([
        c.get(id, owner).catch((e) => e),
        c.command(id, { type: "cancel" }, owner).catch((e) => e),
        c.ingest(id, { eventId: "x", requestId: "y", sequence: 1, type: "ride.confirmed", actor: "demo" }, owner).catch((e) => e),
      ]);
      for (const e of errs) {
        expect(e.status).toBe(404);
        expect(e.message.replace(id, "ID")).toBe(missing.message.replace("nope", "ID"));
      }
    }
    expect(await store.load(id)).toEqual(before);
    expect((await c.get(id, "alice")).plan.state).toBe("AWAITING_APPROVAL");
  });

  it("(f) consent and READY invariants hold through the store", async () => {
    const store = createMemoryStore();
    const c = make(store);
    const id = await toAwaitingApproval(c);
    const calls = provider.calls.length;
    const r = ok(await c.command(id, { type: "execute" }));
    expect(r.outcome).toBe("rejected");
    expect(provider.calls.length).toBe(calls); // nothing sent without approval
    for (const a of pending((await c.get(id)).plan)) ok(await approve(c, id, a));
    ok(await c.command(id, { type: "execute" }));
    const p = (await make(store).get(id)).plan;
    expect(p.state).toBe("PENDING_CONFIRMATION"); // dispatched is not confirmed
    expect(currentDeps(p).every((d) => d.status === "requested")).toBe(true);
    expect(ok(await make(store).command(id, { type: "complete", attended: true })).outcome).toBe("rejected");
  });

  it("(g) full happy path to READY, each step on a fresh instance", async () => {
    const store = createMemoryStore();
    const fresh = () => make(store);
    const id = await toAwaitingApproval(fresh(), "alice");
    for (const a of pending((await fresh().get(id, "alice")).plan)) ok(await approve(fresh(), id, a, "alice"));
    ok(await fresh().command(id, { type: "execute" }, "alice"));
    const p = await confirmAll(fresh(), id, "alice");
    expect(p.state).toBe("READY");
    expect(readyViolations(p)).toEqual([]);
    expect(contiguous(await seqsOf(store, id))).toBe(true);
    expect(ok(await fresh().command(id, { type: "complete", attended: true }, "alice")).plan.state).toBe("COMPLETED");
  });

  it("never re-runs provider dispatch automatically after a lost CAS race", async () => {
    const inner = createMemoryStore();
    const prov = createMockProvider();
    const mk = (store: CoordinationStore) => createCoordinator({ provider: prov, store, now: () => new Date(T0), activities: [WORKSHOP], newId });
    const c = mk(inner);
    const id = await toAwaitingApproval(c);
    for (const a of pending((await c.get(id)).plan)) ok(await approve(c, id, a));
    const before = (await inner.load(id))!;
    let commits = 0;
    const losing: CoordinationStore = { ...inner, kind: inner.kind, commit: async () => (commits++, false) };
    await expect(mk(losing).command(id, { type: "execute" })).rejects.toMatchObject({ status: 409 });
    expect(commits).toBe(1); // no second attempt, so no second dispatch round
    expect(prov.calls.length).toBe(currentActions(before.plan).length);
    expect((await inner.load(id))!.rev).toBe(before.rev);
    // The user's retry reuses the same idempotency keys; the provider dedupes, and the plan proceeds.
    expect(ok(await c.command(id, { type: "execute" })).plan.state).toBe("PENDING_CONFIRMATION");
    expect(prov.calls.length).toBe(currentActions(before.plan).length);
  });
});
