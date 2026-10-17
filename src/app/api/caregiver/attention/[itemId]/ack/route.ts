import { ack, withCaller } from "../../../_lib/service";

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/attention/[itemId]/ack">) {
  const { itemId } = await ctx.params;
  return withCaller(req, (userId) => ack(userId, itemId));
}
