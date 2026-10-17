import { discoverLumaEvents } from "@/lib/integrations/luma";

export async function GET() {
  return Response.json(await discoverLumaEvents(), {
    headers: { "Cache-Control": "no-store" },
  });
}
