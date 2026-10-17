import { revokeGrant, withCaller } from "../../../../_lib/service";

export async function DELETE(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/grants/[userId]">) {
  const { id, userId: target } = await ctx.params;
  return withCaller(req, (userId) => revokeGrant(userId, id, target));
}
