import { ProviderEvent } from "@/lib/schema";
import { coordinator, demoEventsEnabled, handle, parseBody } from "../../../_lib/service";

// Simulated provider/participant callbacks (RSVPs, ride confirmations, cancellations). Demo-only.
export async function POST(req: Request, ctx: RouteContext<"/api/coordination/plans/[id]/events">) {
  if (!demoEventsEnabled()) return Response.json({ error: "Demo provider events are disabled" }, { status: 403 });
  const { id } = await ctx.params;
  const ev = await parseBody(req, ProviderEvent);
  if (ev instanceof Response) return ev;
  return handle(() => coordinator.ingest(id, ev));
}
