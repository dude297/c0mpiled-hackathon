import { CreatePlanInput } from "@/lib/schema";
import { context, handle, parseBody } from "../_lib/service";

export async function POST(req: Request) {
  const c = await context(req);
  if (c instanceof Response) return c;
  const input = await parseBody(req, CreatePlanInput);
  if (input instanceof Response) return input;
  return handle(c, () => c.coordinator.create(input, c.userId));
}
