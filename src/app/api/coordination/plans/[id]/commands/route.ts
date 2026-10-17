import { PlanCommand } from "@/lib/schema";
import { coordinator, handle, parseBody } from "../../../_lib/service";

export async function POST(req: Request, ctx: RouteContext<"/api/coordination/plans/[id]/commands">) {
  const { id } = await ctx.params;
  const cmd = await parseBody(req, PlanCommand);
  if (cmd instanceof Response) return cmd;
  return handle(() => coordinator.command(id, cmd));
}
