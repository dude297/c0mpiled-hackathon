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

// Optional CAPTCHA (Cloudflare Turnstile) for guest sign-in. Only used when NEXT_PUBLIC_TURNSTILE_SITE_KEY is
// set AND the UI registers a token provider (no widget ships yet). Hosted: enable CAPTCHA in Supabase Auth
// settings with the Turnstile secret, or Auth ignores/rejects tokens accordingly (docs/daybridge/CLOUD_DEPLOY.md).
export const captchaSiteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
let captchaProvider: (() => Promise<string>) | undefined;
export function setCaptchaTokenProvider(fn: (() => Promise<string>) | undefined) {
  captchaProvider = fn;
}

/** Existing session, else a new anonymous (guest) one. Null in local mode. */
export async function ensureSession() {
  if (!cloudEnabled()) return null;
  const sb = browserClient();
  const { data } = await sb.auth.getSession(); // refreshes an expired access token if needed
  if (data.session) return data.session;
  const captchaToken = captchaSiteKey() && captchaProvider ? await captchaProvider() : undefined;
  const { data: signed, error } = await sb.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error || !signed.session) throw new Error(`Guest sign-in failed: ${error?.message ?? "no session"}`);
  return signed.session;
}

/**
 * fetch that adds `Authorization: Bearer <access_token>` when cloud is enabled; plain fetch otherwise.
 * On a 401 it refreshes the session once and retries the same request once (auth fails before any
 * state change, so the retry is safe). Bodies must be re-sendable (strings/JSON), which ours are.
 */
export async function authFetch(input: string, init: RequestInit = {}) {
  const session = await ensureSession();
  if (!session) return fetch(input, init);
  const withToken = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  const res = await withToken(session.access_token);
  if (res.status !== 401) return res;
  const { data } = await browserClient().auth.refreshSession();
  return data.session ? withToken(data.session.access_token) : res;
}
