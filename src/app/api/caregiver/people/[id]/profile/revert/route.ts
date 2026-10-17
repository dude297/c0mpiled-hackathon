import { withCaller } from "../../../../_lib/service";
import { revert } from "../_lib";

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/profile/revert">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => revert(userId, id, req));
}
