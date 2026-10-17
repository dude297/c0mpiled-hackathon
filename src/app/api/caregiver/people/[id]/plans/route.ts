import { createPlan, withCaller } from "../../../_lib/service";

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/plans">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => createPlan(userId, id, req));
}
