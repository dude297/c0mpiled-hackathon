import { coordinator, handle } from "../../_lib/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/coordination/plans/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => coordinator.get(id));
}
