import { withCaller } from "../../../../../../_lib/service";
import { decide } from "../../../_lib";

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/profile/proposals/[pid]/reject">) {
  const { id, pid } = await ctx.params;
  return withCaller(req, (userId) => decide(userId, id, pid, req, "rejected"));
}
