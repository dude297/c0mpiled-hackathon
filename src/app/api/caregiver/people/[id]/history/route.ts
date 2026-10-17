import { history, withCaller } from "../../../_lib/service";

export async function GET(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/history">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => history(userId, id, new URL(req.url)));
}
