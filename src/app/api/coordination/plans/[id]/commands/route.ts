import { PlanCommand } from "@/lib/schema";
import { context, handle, parseBody } from "../../../_lib/service";

export async function POST(req: Request, ctx: RouteContext<"/api/coordination/plans/[id]/commands">) {
  const { id } = await ctx.params;
  const c = await context(req);
  if (c instanceof Response) return c;
  const cmd = await parseBody(req, PlanCommand);
  if (cmd instanceof Response) return cmd;
  return handle(c, () => c.coordinator.command(id, cmd, c.userId));
}
