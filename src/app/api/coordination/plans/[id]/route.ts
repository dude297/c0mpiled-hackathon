import { context, handle } from "../../_lib/service";

export async function GET(req: Request, ctx: RouteContext<"/api/coordination/plans/[id]">) {
  const { id } = await ctx.params;
  const c = await context(req);
  if (c instanceof Response) return c;
  return handle(c, () => c.coordinator.get(id, c.userId));
}
