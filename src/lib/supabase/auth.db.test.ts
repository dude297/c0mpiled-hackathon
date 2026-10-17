import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getUserId } from "./auth";

// Real-token tests against a LOCAL Supabase stack. Skipped unless env is set, e.g. (from `supabase status -o env`):
//   SUPABASE_URL=$API_URL SUPABASE_SECRET_KEY=$SECRET_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY \
//   SUPABASE_JWT_SECRET=$JWT_SECRET npx vitest run src/lib/supabase/auth.db.test.ts
// SUPABASE_JWT_SECRET is optional: only the re-signing tests (expiry) need it, and only for HS256 stacks.
const URL = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const enabled = !!(URL && SECRET && PUBLISHABLE);
if (enabled && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL!)) throw new Error("auth.db.test.ts only runs against a local Supabase stack");

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const parts = (jwt: string) => jwt.split(".");
const payload = (jwt: string) => JSON.parse(Buffer.from(parts(jwt)[1], "base64url").toString());
const sign = (h: object, p: object) => {
  const input = `${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(p))}`;
  return `${input}.${b64url(createHmac("sha256", JWT_SECRET!).update(input).digest())}`;
};
const req = (token: string) => new Request("http://x/api", { headers: { authorization: `Bearer ${token}` } });
const anonClient = () => createClient(URL!, PUBLISHABLE!, { auth: { persistSession: false, autoRefreshToken: false } });

describe.skipIf(!enabled)("getUserId against the local Supabase stack", () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  async function anonSession() {
    const client = anonClient();
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.session) throw new Error(`anonymous sign-in failed: ${error?.message}`);
    created.push(data.session.user.id);
    return { client, token: data.session.access_token, id: data.session.user.id };
  }

  let alice: Awaited<ReturnType<typeof anonSession>>;
  let bob: Awaited<ReturnType<typeof anonSession>>;
  beforeAll(async () => {
    admin = createClient(URL!, SECRET!, { auth: { persistSession: false, autoRefreshToken: false } });
    alice = await anonSession();
    bob = await anonSession();
  });
  afterAll(async () => {
    for (const id of created) await admin?.auth.admin.deleteUser(id).catch(() => {});
  });

  it("accepts a real anonymous-session token and returns its user id", async () => {
    expect(await getUserId(req(alice.token))).toBe(alice.id);
    expect(await getUserId(req(bob.token))).toBe(bob.id);
  });

  it("rejects a token with a tampered signature", async () => {
    const [h, p, s] = parts(alice.token);
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(await getUserId(req(`${h}.${p}.${flipped}`))).toBeNull();
    expect(await getUserId(req(`${h}.${p}.`))).toBeNull();
  });

  it("rejects a forged payload claiming another user's sub (original signature kept)", async () => {
    const [h, , s] = parts(alice.token);
    const forged = `${h}.${b64url(JSON.stringify({ ...payload(alice.token), sub: bob.id }))}.${s}`;
    expect(await getUserId(req(forged))).toBeNull();
  });

  it("rejects alg=none tokens", async () => {
    const p = b64url(JSON.stringify(payload(alice.token)));
    expect(await getUserId(req(`${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${p}.`))).toBeNull();
  });

  // The local stack issues ES256 tokens (asymmetric signing keys) but GoTrue still verifies legacy HS256 tokens
  // signed with JWT_SECRET, so we can mint: same claims as a real session, only iat/exp changed.
  describe.skipIf(!JWT_SECRET)("expiry (claims of a real session, re-signed HS256 with the stack's JWT secret)", () => {
    const HS = { alg: "HS256", typ: "JWT" };
    it("control: a re-signed, unexpired copy of a real token IS accepted (so the signing is right)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const t = sign(HS, { ...payload(alice.token), iat: now - 10, exp: now + 600 });
      expect(await getUserId(req(t))).toBe(alice.id);
    });

    it("an otherwise-valid token with exp in the past is rejected", async () => {
      const now = Math.floor(Date.now() / 1000);
      const t = sign(HS, { ...payload(alice.token), iat: now - 7200, exp: now - 60 });
      expect(await getUserId(req(t))).toBeNull();
    });
  });

  it("rejects the token of a deleted user", async () => {
    const carol = await anonSession();
    expect(await getUserId(req(carol.token))).toBe(carol.id);
    const { error } = await admin.auth.admin.deleteUser(carol.id);
    expect(error).toBeNull();
    expect(await getUserId(req(carol.token))).toBeNull();
  });

  it("signed-out session: records whether the old access token is still accepted", async () => {
    const dave = await anonSession();
    expect(await getUserId(req(dave.token))).toBe(dave.id);
    const { error } = await dave.client.auth.signOut(); // default scope: global (revokes all sessions)
    expect(error).toBeNull();
    // Observed on the local stack (GoTrue checks the JWT's session_id against auth.sessions): rejected.
    expect(await getUserId(req(dave.token))).toBeNull();
  });
});
