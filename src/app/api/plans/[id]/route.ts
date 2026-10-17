import { revokeShare, shareStoreAvailable } from "@/lib/share/share";

// DELETE /api/plans/:id with `Authorization: Bearer <revokeToken>` → 204; unknown id or wrong token → 404 (indistinguishable).
export async function DELETE(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  if (!shareStoreAvailable()) return Response.json({ error: "Sharing is not available on this deployment yet." }, { status: 503 });
  const { id } = await ctx.params;
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!revokeShare(id, token)) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
