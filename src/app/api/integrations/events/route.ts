import { connection } from "next/server";
import { discoverPublicEvents } from "@/lib/integrations/events";

// Off unless explicitly enabled: no outbound requests in the default (offline) demo or hosted builds.
const eventsEnabled = () => process.env.DAYBRIDGE_EVENTS === "1";

// No profile or client location is accepted or forwarded to the source.
export async function GET() {
  await connection(); // per-request: the flag must not be frozen at build time
  if (!eventsEnabled()) return Response.json({ status: "disabled" }, { headers: { "Cache-Control": "no-store" } });
  return Response.json(await discoverPublicEvents(), { headers: { "Cache-Control": "no-store" } });
}
