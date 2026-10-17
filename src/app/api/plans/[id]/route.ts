import { revokeShare, shareStoreAvailable } from "@/lib/share/share";

// DELETE /api/plans/:id with `Authorization: Bearer <revokeToken>` → 204; unknown id or wrong token → 404 (indistinguishable).
export async function DELETE(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  if (!shareStoreAvailable()) return Response.json({ error: "Sharing is not available on this deployment yet." }, { status: 503 });
  const { id } = await ctx.params;
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  let revoked: boolean;
  try {
    revoked = await revokeShare(id, token);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "share revoke failed");
    return Response.json({ error: "Sharing is not available right now." }, { status: 503 });
  }
  if (!revoked) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
