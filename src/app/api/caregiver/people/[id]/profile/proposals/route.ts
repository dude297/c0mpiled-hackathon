import { withCaller } from "../../../../_lib/service";
import { listProposals, propose } from "../_lib";

export async function GET(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/profile/proposals">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => listProposals(userId, id, new URL(req.url)));
}

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/profile/proposals">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => propose(userId, id, req));
}
