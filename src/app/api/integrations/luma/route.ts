import { connection } from "next/server";
import { discoverLumaEvents } from "@/lib/integrations/luma";

export async function GET() {
  // Evaluate DAYBRIDGE_LUMA at request time, not at build time (cacheComponents-compatible).
  await connection();
  return Response.json(await discoverLumaEvents(), {
    headers: { "Cache-Control": "no-store" },
  });
}
