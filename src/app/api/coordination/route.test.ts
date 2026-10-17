import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import { CommandResult, CoordinationPlan } from "@/lib/schema";
import { POST as create } from "./plans/route";
import { GET as getPlan } from "./plans/[id]/route";
import { POST as command } from "./plans/[id]/commands/route";
import { POST as events } from "./plans/[id]/events/route";

const json = (body: unknown) => new Request("http://test", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

afterEach(() => vi.unstubAllEnvs());

describe("coordination API", () => {
  it("creates a plan and returns a contract-valid result for any catalog activity", async () => {
    // Catalog-agnostic: the human-owned activity list may change.
    const res = await create(json({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id, contacts: [{ id: "c1", name: "Pat", canDrive: true }] }));
    expect(res.status).toBe(200);
    const body = CommandResult.parse(await res.json());
    expect(["BLOCKED", "PROPOSED"]).toContain(body.plan.state);
    expect(body.plan.dataSource).toBe("mock");

    const got = await getPlan(new Request("http://test"), ctx(body.plan.id));
    const { plan, events: log } = (await got.json()) as { plan: unknown; events: unknown[] };
    expect(CoordinationPlan.parse(plan).id).toBe(body.plan.id);
    expect(log.length).toBeGreaterThan(0);
  });

  it("validates input and reports unknown plans/activities", async () => {
    expect((await create(json({}))).status).toBe(400);
    expect((await create(json({ profile: DEMO_PROFILES.margaret, activityId: "no-such-activity" }))).status).toBe(400);
    expect((await getPlan(new Request("http://test"), ctx("missing"))).status).toBe(404);
    expect((await command(json({ type: "cancel" }), ctx("missing"))).status).toBe(404);
    const made = CommandResult.parse(await (await create(json({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }))).json());
    expect((await command(json({ type: "launch_rockets" }), ctx(made.plan.id))).status).toBe(400);
    expect((await command(json({ type: "approve", actionId: "x", scope: {}, expiresAt: "soon" }), ctx(made.plan.id))).status).toBe(400);
  });

  it("forged provider callbacks are recorded as rejected, never applied", async () => {
    const made = CommandResult.parse(await (await create(json({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }))).json());
    const res = await events(json({ eventId: "e1", requestId: "forged", sequence: 1, type: "ride.confirmed", actor: "demo" }), ctx(made.plan.id));
    const body = CommandResult.parse(await res.json());
    expect(body.outcome).toBe("rejected");
    expect(body.plan.state).toBe(made.plan.state);
  });

  it("fails closed in hosted production: every coordination route returns 503 without the local-demo flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const created = await create(json({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }));
    expect(created.status).toBe(503);
    expect(((await created.json()) as { error: string }).error).toMatch(/local demo/);
    expect((await getPlan(new Request("http://test"), ctx("any"))).status).toBe(503);
    expect((await command(json({ type: "cancel" }), ctx("any"))).status).toBe(503);
    vi.stubEnv("DAYBRIDGE_DEMO_EVENTS", "1");
    expect((await create(json({ profile: DEMO_PROFILES.margaret, activityId: ACTIVITIES[0].id }))).status).toBe(200);
  });

  it("disables the demo provider-event endpoint in production unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await events(json({}), ctx("any"))).status).toBe(403);
    vi.stubEnv("DAYBRIDGE_DEMO_EVENTS", "1");
    expect((await events(json({}), ctx("any"))).status).toBe(400);
  });
});
