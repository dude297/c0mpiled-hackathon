// Test-only fixture: a real, approved coordination plan whose identifiers are planted into a share payload.
// Used to prove a share snapshot carries no coordination/approval authority or private data.
import { ACTIVITIES, DEMO_PROFILES } from "@/domain/activities";
import { runScenario } from "@/domain/engine";
import { createCoordinator, currentActions } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import { createMemoryStore } from "@/domain/coordination/store";
import type { AnalysisResult, CoordinationPlan } from "@/lib/schema";

export const PROFILE_NAME = "Philomena Quarrington";
export const CONTACTS = [
  { id: "contact-zebediah", name: "Zebediah Okonkwo-Lindqvist", relation: "son", canDrive: true },
  { id: "contact-ysolde", name: "Ysolde Marchbanks", relation: "friend", canDrive: false },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function approvedPlan(): Promise<{ plan: CoordinationPlan; secrets: string[] }> {
  const c = createCoordinator({ provider: createMockProvider(), store: createMemoryStore() });
  for (const base of Object.values(DEMO_PROFILES))
    for (const a of ACTIVITIES) {
      const { plan } = await c.create({ profile: { ...base, name: PROFILE_NAME }, activityId: a.id, contacts: CONTACTS }, null);
      if (plan.state !== "PROPOSED" || !currentActions(plan).length) continue;
      await c.command(plan.id, { type: "accept_proposal" }, null);
      for (const x of currentActions(plan))
        await c.command(plan.id, { type: "approve", actionId: x.id, scope: x.scope, expiresAt: new Date(Date.now() + 3600_000).toISOString() }, null);
      const { plan: p } = await c.get(plan.id, null);
      const ids = new Set<string>();
      JSON.stringify(p, (k, v) => (typeof v === "string" && (UUID.test(v) || k === "idempotencyKey") && ids.add(v), v));
      const secrets = [...ids, ...CONTACTS.flatMap((x) => [x.id, x.name]), PROFILE_NAME, ...PROFILE_NAME.split(" ")];
      if (!p.approvals.length || !p.actions.some((x) => x.idempotencyKey)) throw new Error("fixture plan has no approvals/keys");
      return { plan: p, secrets };
    }
  throw new Error("No catalog activity yields an actionable proposal");
}

// A share payload built from the same profile, with every coordination secret planted in free text and extra keys.
export function poisonedResult(plan: CoordinationPlan, secrets: string[]): AnalysisResult {
  const out = runScenario({ profile: plan.profile });
  const s = secrets.join(" ");
  return {
    ...out,
    summary: `1 activity ${PROFILE_NAME} can actually attend this week.`,
    plan: out.plan.map((i) => ({ ...i, name: `${i.name} ${s}`, travel: `${i.travel} ${s}`, ...{ coordinationPlanId: plan.id, actions: plan.actions } })),
    explanation: s,
    dataSource: "mock",
    ...{ coordinationPlanId: plan.id, approvals: plan.approvals, contacts: plan.contacts, profile: plan.profile },
  } as AnalysisResult;
}
