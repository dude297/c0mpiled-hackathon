import { createShare, MAX_BODY_CHARS, shareStoreAvailable, ShareInput } from "@/lib/share/share";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// POST /api/plans — create an opt-in, redacted, read-only snapshot. See docs/daybridge/SHARE_CONTRACT.md.
export async function POST(req: Request) {
  if (!shareStoreAvailable()) return json({ error: "Sharing is not available on this deployment yet." }, 503);
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
  const { id, revokeToken, expiresAt } = createShare(parsed.data);
  return json({ id, url: `/plan/${id}`, revokeToken, expiresAt }, 201);
}
