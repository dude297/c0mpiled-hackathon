import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ACTIVITIES } from "@/domain/activities";
import { AnalysisResult } from "@/lib/schema";

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

export type SharedItem = { name: string; when: string; travel: string; costPerWeek: number; tips: string[] };
export type SharedPlan = {
  displayName: string;
  summary: string;
  items: SharedItem[];
  dataSource: "mock" | "live";
  createdAt: string;
  expiresAt: string;
};

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

// ─── In-memory demo store ───
// ponytail: process memory, lost on restart and not shared across instances. Swap for a DB table before real use.
type Entry = { plan: SharedPlan; tokenHash: Buffer };
const g = globalThis as typeof globalThis & { __daybridgeShares?: Map<string, Entry> };
const store = (g.__daybridgeShares ??= new Map());

export const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 128-bit base64url
const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function shareStoreAvailable(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SHARE_STORE === "memory";
}

function prune(now: number) {
  for (const [id, e] of store) if (Date.parse(e.plan.expiresAt) <= now) store.delete(id);
}

export function createShare(input: ShareInput, now = new Date()) {
  prune(now.getTime());
  while (store.size >= MAX_SHARES) store.delete(store.keys().next().value!); // evict oldest
  const plan = redact(input, now);
  const id = randomBytes(16).toString("base64url");
  const revokeToken = randomBytes(32).toString("base64url");
  store.set(id, { plan, tokenHash: sha256(revokeToken) });
  return { id, revokeToken, expiresAt: plan.expiresAt };
}

export function getShare(id: string, now = new Date()): SharedPlan | null {
  if (!ID_RE.test(id)) return null;
  const e = store.get(id);
  if (!e) return null;
  if (Date.parse(e.plan.expiresAt) <= now.getTime()) {
    store.delete(id);
    return null;
  }
  return e.plan;
}

export function revokeShare(id: string, token: string): boolean {
  const e = ID_RE.test(id) ? store.get(id) : undefined;
  if (!e || !timingSafeEqual(sha256(token), e.tokenHash)) return false;
  store.delete(id);
  return true;
}

export function _resetShareStore() {
  store.clear();
}
export const _shareStoreSize = () => store.size;
