import { listGrants, upsertGrant, withCaller } from "../../../_lib/service";

export async function GET(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/grants">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => listGrants(userId, id));
}

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/grants">) {
  const { id } = await ctx.params;
  return withCaller(req, (userId) => upsertGrant(userId, id, req));
}
