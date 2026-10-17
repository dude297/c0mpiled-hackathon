import { withCaller } from "../../../../../_lib/service";
import { feedbackProposals } from "../../../profile/_lib";

export async function POST(req: Request, ctx: RouteContext<"/api/caregiver/people/[id]/plans/[planId]/feedback-proposals">) {
  const { id, planId } = await ctx.params;
  return withCaller(req, (userId) => feedbackProposals(userId, id, planId));
}
