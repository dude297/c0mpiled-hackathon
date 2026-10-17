import { adminClient } from "@/lib/supabase/server";

const MAX_AUTH_HEADER = 8192;

/**
 * Verifies `Authorization: Bearer <jwt>` against Supabase Auth (server-side; never decode-and-trust).
 * Returns the user id, or null on any missing/malformed/invalid/expired token or verification error (fail closed).
 * Never logs the token.
 */
export async function getUserId(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header || header.length > MAX_AUTH_HEADER) return null;
  const match = /^Bearer ([A-Za-z0-9\-_.]+)$/.exec(header.trim());
  if (!match) return null;
  try {
    const { data, error } = await adminClient().auth.getUser(match[1]);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}
