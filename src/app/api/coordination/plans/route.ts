import { CreatePlanInput } from "@/lib/schema";
import { coordinator, handle, parseBody } from "../_lib/service";

export async function POST(req: Request) {
  const input = await parseBody(req, CreatePlanInput);
  if (input instanceof Response) return input;
  return handle(() => coordinator.create(input));
}
