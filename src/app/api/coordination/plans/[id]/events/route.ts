import { ProviderEvent } from "@/lib/schema";
import { context, demoEventsEnabled, handle, parseBody } from "../../../_lib/service";

// Simulated provider/participant callbacks (RSVPs, ride confirmations, cancellations). Demo-only.
// The gate runs before auth so production answers 403 regardless of sign-in state.
export async function POST(req: Request, ctx: RouteContext<"/api/coordination/plans/[id]/events">) {
  if (!demoEventsEnabled()) return Response.json({ error: "Demo provider events are disabled" }, { status: 403 });
  const { id } = await ctx.params;
  const c = await context(req);
  if (c instanceof Response) return c;
  const ev = await parseBody(req, ProviderEvent);
  if (ev instanceof Response) return ev;
  return handle(c, () => c.coordinator.ingest(id, ev, c.userId));
}
