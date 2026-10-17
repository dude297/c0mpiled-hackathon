import { overview, withCaller } from "../_lib/service";

export async function GET(req: Request) {
  return withCaller(req, (userId) => overview(userId));
}
