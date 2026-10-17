import { revokeShare, revokeShareAsCreator, shareStoreAvailable, shareStoreKind } from "@/lib/share/share";
import { getUserId } from "@/lib/supabase/auth";

// DELETE /api/plans/:id with `Authorization: Bearer <revokeToken>` → 204; unknown id or wrong token → 404 (indistinguishable).
// Cloud candidate: the bearer may instead be the creator's Supabase access token (recovery after losing the revoke token).
// The revoke-token hash is tried first; only on a miss is the bearer verified as a user. Every failure is the same 404.
export async function DELETE(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  if (!shareStoreAvailable()) return Response.json({ error: "Sharing is not available on this deployment yet." }, { status: 503 });
  const { id } = await ctx.params;
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  let revoked: boolean;
  try {
    revoked = await revokeShare(id, token);
    if (!revoked && token && shareStoreKind() === "supabase") {
      const userId = await getUserId(req);
      revoked = !!userId && (await revokeShareAsCreator(id, userId));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : "share revoke failed");
    return Response.json({ error: "Sharing is not available right now." }, { status: 503 });
  }
  if (!revoked) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
