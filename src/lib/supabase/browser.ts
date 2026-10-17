import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser client: publishable key only (public by design). Never put the secret key here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const cloudEnabled = () => !!(url && key);

let client: SupabaseClient | undefined;
export function browserClient(): SupabaseClient {
  if (!cloudEnabled()) throw new Error("Cloud is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  return (client ??= createClient(url!, key!)); // default: session persisted in localStorage, auto-refresh on
}

/** Existing session, else a new anonymous (guest) one. Null in local mode. */
export async function ensureSession() {
  if (!cloudEnabled()) return null;
  const sb = browserClient();
  const { data } = await sb.auth.getSession(); // refreshes an expired access token if needed
  if (data.session) return data.session;
  const { data: signed, error } = await sb.auth.signInAnonymously();
  if (error || !signed.session) throw new Error(`Guest sign-in failed: ${error?.message ?? "no session"}`);
  return signed.session;
}

/** fetch that adds `Authorization: Bearer <access_token>` when cloud is enabled; plain fetch otherwise. */
export async function authFetch(input: string, init: RequestInit = {}) {
  const session = await ensureSession();
  if (!session) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
