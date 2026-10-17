import { describePlan } from "@/domain/coordination/narrative";
import { coordinator, handle } from "../../_lib/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/coordination/plans/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => {
    const got = coordinator.get(id);
    return { ...got, narrative: describePlan(got.plan) };
  });
}
