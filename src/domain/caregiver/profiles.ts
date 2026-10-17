import { Profile, type CoordinationPlan } from "@/lib/schema";
import { CaregiverError, NOT_FOUND } from "./access";
import type { Grant, Person, ProfileChanges, ProfileVersion, Scope } from "./contract";

// Person-level profile rules (pure). Storage atomicity lives in the store; see docs/daybridge/PERSON_PROFILES.md.

export type ProfileAction = "read" | "propose" | "decide" | "revert";

const ALLOWED: Record<ProfileAction, { scopes: Scope[]; self: boolean }> = {
  read: { scopes: ["view"], self: true },
  propose: { scopes: ["checkin", "manage"], self: true },
  decide: { scopes: ["manage"], self: true },
  revert: { scopes: ["manage"], self: false },
};

/** No grant and not self → 404 (no existence leak); known but lacking scope → 403. */
export function profileAccess(person: Person | null, grant: Grant | null, userId: string, action: ProfileAction) {
  if (!person) throw new CaregiverError(404, NOT_FOUND);
  const active = grant && !grant.revokedAt && grant.personId === person.personId && grant.userId === userId ? grant : null;
  const isSelf = !!person.selfUserId && person.selfUserId === userId;
  if (!active && !isSelf) throw new CaregiverError(404, NOT_FOUND);
  const rule = ALLOWED[action];
  const scopes = active?.scopes ?? [];
  if (!(rule.self && isSelf) && !rule.scopes.some((s) => scopes.includes(s)))
    throw new CaregiverError(403, `Requires the ${rule.scopes.map((s) => `"${s}"`).join(" or ")} scope${rule.self ? " (or being the person)" : ""}`);
  return { person, scopes, isSelf };
}

export const currentVersion = (p: Person) => p.profileVersion ?? 1;

/** Drops changes that equal the current value (arrays compared in order). */
export function effectiveChanges(current: Profile, changes: ProfileChanges): ProfileChanges {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) if (JSON.stringify(current[k as keyof Profile]) !== JSON.stringify(v)) out[k] = v;
  return out as ProfileChanges;
}

/**
 * Coordinator feedback patches (status "proposed") → one person-level change set. Each value is re-validated
 * against Profile.shape; invalid ones and no-ops are dropped. Never mutates the plan.
 */
export function changesFromFeedback(current: Profile, plan: Pick<CoordinationPlan, "preferencePatches">) {
  const changes: Record<string, unknown> = {};
  const evidence: string[] = [];
  for (const p of plan.preferencePatches) {
    if (p.status !== "proposed") continue;
    const field = Profile.shape[p.field as keyof typeof Profile.shape];
    if (!field || !field.safeParse(p.to).success) continue;
    changes[p.field] = p.to;
    evidence.push(p.evidence);
  }
  return { changes: effectiveChanges(current, changes as ProfileChanges), evidence: evidence.join("; ").slice(0, 280) };
}

export const MAX_VERSIONS_LIMIT = 50;

/** Newest first. Cursor = the last version number returned (opaque string to clients). */
export function pageVersions(all: ProfileVersion[], limit: number, cursor: number | null) {
  const sorted = [...all].sort((a, b) => b.version - a.version).filter((v) => cursor === null || v.version < cursor);
  const items = sorted.slice(0, Math.min(limit, MAX_VERSIONS_LIMIT));
  const more = sorted.length > items.length;
  return { items, nextCursor: more ? String(items.at(-1)!.version) : null };
}
