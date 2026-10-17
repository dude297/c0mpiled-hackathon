import { withCaller } from "../../../../_lib/service";
import { listVersions } from "../_lib";

export async function GET(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/profile/versions">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => listVersions(userId, id, new URL(req.url)));
}
