import { discoverPublicEvents } from "@/lib/integrations/events";

// No profile or client location is accepted or forwarded to the source.
export async function GET() {
  return Response.json(await discoverPublicEvents(), { headers: { "Cache-Control": "no-store" } });
}
