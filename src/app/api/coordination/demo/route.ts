import { z } from "zod";
import { ACTIVITIES } from "@/domain/activities";
import { DEMO_SCENARIOS, resolveDemoActivity } from "@/domain/coordination/demo";
import { describePlan } from "@/domain/coordination/narrative";
import { coordinator, demoEventsEnabled, handle } from "../_lib/service";

const DemoInput = z.object({ scenario: z.enum(["maya"]).default("maya") });

// One-click demo plan from a seeded scenario. Demo-only: same production gate as the events endpoint.
export async function POST(req: Request) {
  if (!demoEventsEnabled()) return Response.json({ error: "Demo endpoints are disabled" }, { status: 403 });
  const parsed = DemoInput.safeParse(await req.json().catch(() => ({}))); // empty body → default scenario
  if (!parsed.success) return Response.json({ error: `scenario: ${parsed.error.issues[0]?.message ?? "invalid"}` }, { status: 400 });
  const s = DEMO_SCENARIOS[parsed.data.scenario];
  const activityId = resolveDemoActivity(ACTIVITIES, s.profile, s.contacts, s.activityId);
  if (!activityId) return Response.json({ error: "No activity in the catalog supports the demo scenario" }, { status: 500 });
  return handle(async () => {
    const res = await coordinator.create({ profile: s.profile, activityId, contacts: s.contacts });
    return { ...res, narrative: describePlan(res.plan) };
  });
}
