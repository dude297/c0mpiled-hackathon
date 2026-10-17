import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ACTIVITIES } from "@/domain/activities";
import { AnalysisResult } from "@/lib/schema";
import { adminClient, supabaseConfigured } from "@/lib/supabase/server";

// Opt-in, redacted, read-only plan snapshots. See docs/daybridge/SHARE_CONTRACT.md.
// Redaction is an ALLOWLIST: nothing from the client payload is copied verbatim except
// catalog-validated activity ids, the travel mode bucket, soft-barrier rule names, and dataSource.

export const ShareInput = z
  .object({
    result: AnalysisResult,
    consent: z.literal(true),
    firstNameOnly: z.boolean().optional(),
    expiresInDays: z.number().int().min(1).max(30).optional(),
  })
  .strict();
export type ShareInput = z.infer<typeof ShareInput>;

// Shape of a stored snapshot. Re-validated on every durable read: anything else is treated as not found.
const SharedItem = z.object({ name: z.string(), when: z.string(), travel: z.string(), costPerWeek: z.number(), tips: z.array(z.string()) }).strict();
export const SharedPlan = z
  .object({
    displayName: z.string(),
    summary: z.string(),
    items: z.array(SharedItem).max(7),
    dataSource: z.enum(["mock", "live"]),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type SharedItem = z.infer<typeof SharedItem>;
export type SharedPlan = z.infer<typeof SharedPlan>;

export const MAX_BODY_CHARS = 200_000;
export const MAX_SHARES = 1000;
export const DEFAULT_EXPIRY_DAYS = 7;
const DAY_MS = 86_400_000;

// Fixed, non-identifying tips per soft-barrier rule. Barrier detail/mitigation text is never copied.
const TIPS: Record<string, string> = {
  access: "Call ahead to confirm the entrance and seating.",
  transport: "Confirm the ride the day before.",
  hearing: "Arrive a little early to pick a good seat.",
  social: "Bringing a friend to the first visit can help.",
};

const PUBLIC_MODES = new Set(["drive", "bus", "walk"]);
function travelBucket(travel: string): string {
  const mode = travel.split(",")[0]?.trim().toLowerCase() ?? "";
  // paratransit / family (or anything unexpected) reveal care arrangements → generic label
  return PUBLIC_MODES.has(mode) ? mode : "arranged ride";
}

// Names only come from the engine's own summary templates (src/domain/engine.ts), first token only.
const SUMMARY_NAME = [/^\d+ activit(?:y|ies) (.+) can actually attend this week\.$/, /^No activity fits (.+)'s constraints yet\./];
export function firstNameFrom(summary: string): string | null {
  for (const re of SUMMARY_NAME) {
    const full = re.exec(summary)?.[1];
    const first = full?.trim().split(/\s+/)[0];
    if (first && /^\p{L}[\p{L}'-]{0,29}$/u.test(first)) return first;
  }
  return null;
}

export function redact(input: ShareInput, now = new Date()): SharedPlan {
  const items: SharedItem[] = [];
  const seen = new Set<string>();
  for (const p of input.result.plan) {
    const a = ACTIVITIES.find((x) => x.id === p.activityId);
    if (!a || seen.has(a.id)) continue; // tampered / unknown ids are dropped
    seen.add(a.id);
    const rules = [...new Set(p.barriers.filter((b) => b.severity === "soft").map((b) => b.rule))];
    items.push({
      name: a.name,
      when: `${a.day} ${a.time}`,
      travel: travelBucket(p.travel),
      costPerWeek: a.costPerWeek,
      tips: rules.flatMap((r) => (TIPS[r] ? [TIPS[r]] : [])),
    });
    if (items.length >= 7) break;
  }
  const displayName = (input.firstNameOnly && firstNameFrom(input.result.summary)) || "Someone";
  const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  return {
    displayName,
    summary: items.length
      ? `${displayName}'s plan for this week: ${items.length} activit${items.length === 1 ? "y" : "ies"}.`
      : `${displayName} has no activities planned yet.`,
    items,
    dataSource: input.result.dataSource,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
  };
}

// ─── Store: Supabase table `share_snapshots` when configured (durable), else in-memory demo map ───
// ponytail: memory mode is process-local, lost on restart and not shared across instances.
type Entry = { plan: SharedPlan; tokenHash: Buffer };
const g = globalThis as typeof globalThis & { __daybridgeShares?: Map<string, Entry> };
const store = (g.__daybridgeShares ??= new Map());
const TABLE = "share_snapshots"; // server-only: RLS on, no policies, no anon/authenticated grants

export const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 128-bit base64url
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const bytea = (b: Buffer) => `\\x${b.toString("hex")}`;

export const shareStoreKind = (): "supabase" | "memory" => (supabaseConfigured() ? "supabase" : "memory");

export function shareStoreAvailable(): boolean {
  return supabaseConfigured() || process.env.NODE_ENV !== "production" || process.env.SHARE_STORE === "memory";
}

function prune(now: number) {
  for (const [id, e] of store) if (Date.parse(e.plan.expiresAt) <= now) store.delete(id);
}

// Throws on a storage failure (routes answer 503).
// `cap` is injectable for tests only; the routes always use MAX_SHARES.
// `creatorUserId` (durable store only) lets a signed-in creator list/revoke later without the token.
export async function createShare(input: ShareInput, now = new Date(), cap = MAX_SHARES, creatorUserId: string | null = null) {
  const plan = redact(input, now);
  const id = randomBytes(16).toString("base64url");
  const revokeToken = randomBytes(32).toString("base64url");
  if (supabaseConfigured()) {
    // One locked transaction: prune expired, insert, evict oldest beyond `cap` (same ceiling as memory).
    const { error } = await adminClient().rpc("share_snapshot_create", {
      p_id: id,
      p_plan: plan,
      p_token_hash: bytea(sha256(revokeToken)),
      p_expires_at: plan.expiresAt,
      p_now: now.toISOString(),
      p_cap: cap,
      p_creator: creatorUserId,
    });
    if (error) throw new Error(`share insert failed: ${error.message}`);
  } else {
    prune(now.getTime());
    while (store.size >= cap) store.delete(store.keys().next().value!); // evict oldest
    store.set(id, { plan, tokenHash: sha256(revokeToken) });
  }
  return { id, revokeToken, expiresAt: plan.expiresAt };
}

// Missing, expired, invalid or unreadable → null (page 404). Never throws.
export async function getShare(id: string, now = new Date()): Promise<SharedPlan | null> {
  if (!ID_RE.test(id)) return null;
  if (supabaseConfigured()) {
    const { data, error } = await adminClient().from(TABLE).select("plan").eq("id", id).gt("expires_at", now.toISOString()).maybeSingle();
    if (error) {
      console.error("share read failed:", error.message);
      return null;
    }
    if (!data) return null;
    const parsed = SharedPlan.safeParse(data.plan);
    if (!parsed.success) console.error("share snapshot failed validation; treating as not found");
    return parsed.success ? parsed.data : null;
  }
  const e = store.get(id);
  if (!e) return null;
  if (Date.parse(e.plan.expiresAt) <= now.getTime()) {
    store.delete(id);
    return null;
  }
  return e.plan;
}

// Unknown id / wrong token → false. Throws on a storage failure.
export async function revokeShare(id: string, token: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  if (supabaseConfigured()) {
    // Compared in SQL: both sides are SHA-256 digests of a 256-bit random token, so equality timing
    // leaks nothing usable (an attacker cannot steer the digest of their guess). One atomic delete.
    const { data, error } = await adminClient().from(TABLE).delete().eq("id", id).eq("token_hash", bytea(sha256(token))).select("id");
    if (error) throw new Error(`share revoke failed: ${error.message}`);
    return data.length > 0;
  }
  const e = store.get(id);
  if (!e || !timingSafeEqual(sha256(token), e.tokenHash)) return false;
  store.delete(id);
  return true;
}

// Cloud candidate: creator recovery. Durable store only (memory mode has no creators).
// Deletes only when the row's creator_user_id equals the verified caller. Unknown/foreign/anonymous → false.
export async function revokeShareAsCreator(id: string, userId: string): Promise<boolean> {
  if (!ID_RE.test(id) || !supabaseConfigured()) return false;
  const { data, error } = await adminClient().from(TABLE).delete().eq("id", id).eq("creator_user_id", userId).select("id");
  if (error) throw new Error(`share revoke failed: ${error.message}`);
  return data.length > 0;
}

export type MyShare = { id: string; url: string; expiresAt: string; createdAt: string; summary: string };
// The caller's unexpired shares, newest first. No tokens, no creator id. Throws on a storage failure.
export async function listMyShares(userId: string, now = new Date()): Promise<MyShare[]> {
  const { data, error } = await adminClient()
    .from(TABLE)
    .select("id, expires_at, created_at, summary:plan->>summary")
    .eq("creator_user_id", userId)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(100); // ponytail: no pagination; 100 live links per person is plenty for the demo
  if (error) throw new Error(`share list failed: ${error.message}`);
  return (data as unknown as { id: string; expires_at: string; created_at: string; summary: string | null }[]).map((r) => ({
    id: r.id,
    url: `/plan/${r.id}`,
    expiresAt: new Date(r.expires_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    summary: r.summary ?? "",
  }));
}

export function _resetShareStore() {
  store.clear();
}
export const _shareStoreSize = () => store.size;
