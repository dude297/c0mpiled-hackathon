import { afterEach, describe, expect, it, vi } from "vitest";
import type { Activity } from "@/domain/activities";
import { createCoordinator, currentActions } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import type { Contact, Profile, ProviderEvent } from "@/lib/schema";
import { webhookSecret } from "./providers";
import { REPLAY_WINDOW_SEC, sign, verify } from "./sign";

afterEach(() => vi.unstubAllEnvs());

describe("sign / verify", () => {
  const S = "k".repeat(32);
  const T = 1_800_000_000;
  it("round-trips and rejects tampering, foreign secrets, malformed headers and out-of-window timestamps", () => {
    const h = sign(S, "{}", T);
    expect(h).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verify(S, "{}", h, T)).toBe(true);
    expect(verify(S, "{ }", h, T)).toBe(false);
    expect(verify("x".repeat(32), "{}", h, T)).toBe(false);
    expect(verify(S, "{}", h.toUpperCase(), T)).toBe(false);
    expect(verify(S, "{}", null, T)).toBe(false);
    expect(verify(S, "{}", `${h},v1=${"0".repeat(64)}`, T)).toBe(false);
    expect(verify(S, "{}", h, T + REPLAY_WINDOW_SEC)).toBe(true);
    expect(verify(S, "{}", h, T + REPLAY_WINDOW_SEC + 1)).toBe(false);
    expect(verify(S, "{}", h, T - REPLAY_WINDOW_SEC - 1)).toBe(false);
  });
});

describe("webhookSecret", () => {
  it("only for allowlisted providers with a >= 32 char secret", () => {
    vi.stubEnv("PROVIDER_WEBHOOK_SECRET_MOCK_RIDE", "a".repeat(32));
    vi.stubEnv("PROVIDER_WEBHOOK_SECRET_MOCK_INVITE", "a".repeat(31));
    vi.stubEnv("PROVIDER_WEBHOOK_SECRET_CONSTRUCTOR", "a".repeat(32));
    expect(webhookSecret("mock-ride")).toBe("a".repeat(32));
    expect(webhookSecret("mock-invite")).toBeNull();
    expect(webhookSecret("constructor")).toBeNull();
    expect(webhookSecret("toString")).toBeNull();
  });
});

// Coordinator level: the system caller skips only the owner check.
const WORKSHOP: Activity = { id: "workshop", name: "Saturday Craft Workshop", tags: ["crafts"], day: "Sat", time: "afternoon", costPerWeek: 5, travelMin: { bus: 50, family: 15, paratransit: 25 }, stepFree: true, groupSize: "large", noisy: false, hearingLoop: false };
const MAYA: Profile = { name: "Maya", interests: ["crafts"], mobility: "walker", transport: ["bus", "family", "paratransit"], maxTravelMin: 30, times: ["afternoon"], budgetPerWeek: 20, hearingImpaired: false, prefersSmallGroups: true };
const CONTACTS: Contact[] = [
  { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
  { id: "dan", name: "Dan", relation: "son", canDrive: true },
];
const SYS = { system: true } as const;

describe("system ingest", () => {
  it("bypasses only ownership: superseded requests are ignored and owner checks on user calls remain", async () => {
    const c = createCoordinator({ provider: createMockProvider(), activities: [WORKSHOP] });
    const { plan } = await c.create({ profile: MAYA, activityId: "workshop", contacts: CONTACTS }, "alice");
    await c.command(plan.id, { type: "accept_proposal" }, "alice");
    for (const a of currentActions(plan)) await c.command(plan.id, { type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, "alice");
    const exec = await c.command(plan.id, { type: "execute" }, "alice");
    const invite = currentActions(exec.plan).find((a) => a.scope.kind === "invite")!;
    const ev = (eventId: string, type: ProviderEvent["type"], sequence: number): ProviderEvent => ({ eventId, requestId: invite.providerRequestId!, sequence, type, actor: "provider" });

    // User paths: wrong or missing owner is still 404.
    await expect(c.ingest(plan.id, ev("u1", "invite.accepted", 1), "bob")).rejects.toMatchObject({ status: 404 });
    await expect(c.ingest(plan.id, ev("u2", "invite.accepted", 1), null)).rejects.toMatchObject({ status: 404 });
    await expect(c.get(plan.id, "bob")).rejects.toMatchObject({ status: 404 });

    const declined = await c.ingest(plan.id, ev("s1", "invite.declined", 1), SYS);
    expect(declined.outcome).toBe("applied");
    expect(declined.plan.state).toBe("NEEDS_REPLAN");
    expect(declined.plan.actions.find((a) => a.id === invite.id)!.status).toBe("superseded");
    const late = await c.ingest(plan.id, ev("s2", "invite.accepted", 2), SYS);
    expect(late.outcome).toBe("ignored");
    expect(late.reason).toMatch(/superseded/);
  });
});
