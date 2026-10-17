import { createPerson, withCaller } from "../_lib/service";

export async function POST(req: Request) {
  return withCaller(req, (userId) => createPerson(userId, req));
}
