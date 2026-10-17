import { checkIn, withCaller } from "../../../_lib/service";

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/checkins">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => checkIn(userId, id, req));
}
