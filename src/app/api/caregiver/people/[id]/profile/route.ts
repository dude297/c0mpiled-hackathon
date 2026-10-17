import { withCaller } from "../../../_lib/service";
import { getProfile } from "./_lib";

export async function GET(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/profile">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => getProfile(userId, id));
}
