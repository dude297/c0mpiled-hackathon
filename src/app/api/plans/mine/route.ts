import { listMyShares, shareStoreAvailable, shareStoreKind } from "@/lib/share/share";
import { getUserId } from "@/lib/supabase/auth";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Cloud candidate. GET /api/plans/mine with `Authorization: Bearer <Supabase access token>` →
// { shares: [{ id, url, expiresAt, createdAt, summary }] } — the caller's unexpired links, newest first. No tokens.
export async function GET(req: Request) {
  if (!shareStoreAvailable()) return json({ error: "Sharing is not available on this deployment yet." }, 503);
  if (shareStoreKind() !== "supabase") return json({ error: "Your shared links are only listed when signed in to the cloud." }, 404);
  const userId = await getUserId(req);
  if (!userId) return json({ error: "Sign in to see your shared links." }, 401);
  try {
    return json({ shares: await listMyShares(userId) }, 200);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "share list failed");
    return json({ error: "Sharing is not available right now." }, 503);
  }
}
