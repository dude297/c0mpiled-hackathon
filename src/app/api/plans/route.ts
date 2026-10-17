import { createShare, MAX_BODY_CHARS, shareStoreAvailable, shareStoreKind, ShareInput } from "@/lib/share/share";
import { getUserId } from "@/lib/supabase/auth";
import { rateLimit, retryAfterSec } from "@/lib/supabase/ratelimit";

// ponytail: trusts the platform's x-forwarded-for first hop (Vercel sets it); unknown clients share one bucket.
const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// POST /api/plans — create an opt-in, redacted, read-only snapshot. See docs/daybridge/SHARE_CONTRACT.md.
export async function POST(req: Request) {
  if (!shareStoreAvailable()) return json({ error: "Sharing is not available on this deployment yet." }, 503);
  // Cloud candidate: a signed-in creator is recorded so they can list/revoke later (GET /api/plans/mine).
  // A present-but-invalid bearer is 401 (authFetch refreshes and retries) so a link is never silently unrecoverable.
  let creator: string | null = null;
  if (shareStoreKind() === "supabase" && req.headers.has("authorization")) {
    creator = await getUserId(req);
    if (!creator) return json({ error: "Your session expired. Please try again." }, 401);
  }
  if (!(await rateLimit(creator ? `plans:user:${creator}` : `plans:ip:${clientIp(req)}`, 20, 3600)))
    return Response.json({ error: "Too many shared links in the last hour. Please try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSec(3600)) } });
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return json({ error: "Plan is too large to share." }, 413);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = ShareInput.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const msg = issue?.path[0] === "consent" ? "Consent is required to share a plan." : issue?.code === "unrecognized_keys" ? `Unexpected field(s): ${issue.keys.join(", ")}. Send only {result, consent, firstNameOnly?, expiresInDays?}.` : (issue?.message ?? "Invalid input");
    return json({ error: msg }, 400);
  }
  let created;
  try {
    created = await createShare(parsed.data, undefined, undefined, creator);
  } catch (err) {
    console.error(err instanceof Error ? err.message : "share create failed");
    return json({ error: "Sharing is not available right now." }, 503);
  }
  const { id, revokeToken, expiresAt } = created;
  return json({ id, url: `/plan/${id}`, revokeToken, expiresAt }, 201);
}
