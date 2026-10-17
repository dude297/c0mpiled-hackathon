import { personDetail, withCaller } from "../../_lib/service";

export async function GET(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => personDetail(userId, id));
}
