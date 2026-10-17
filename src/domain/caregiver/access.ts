import type { Grant, Person, Scope } from "./contract";

export class CaregiverError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

export const NOT_FOUND = "Person not found";

export type Need = Scope | "checkin_or_self";
export type Access = { person: Person; scopes: Scope[]; isSelf: boolean };

// Pure scope decision. Only grants carry authority; selfUserId may only check in for themselves.
// No grant at all (and not self checking in) → 404, never 403, so existence never leaks.
export function decideAccess(person: Person | null, grant: Grant | null, userId: string, need: Need): Access {
  if (!person) throw new CaregiverError(404, NOT_FOUND);
  const active = grant && !grant.revokedAt && grant.personId === person.personId && grant.userId === userId ? grant : null;
  const isSelf = !!person.selfUserId && person.selfUserId === userId;
  const scopes = active?.scopes ?? [];
  if (!active && !(isSelf && need === "checkin_or_self")) throw new CaregiverError(404, NOT_FOUND);
  const ok = need === "checkin_or_self" ? isSelf || scopes.includes("checkin") : scopes.includes(need);
  if (!ok) throw new CaregiverError(403, `Requires the "${need === "checkin_or_self" ? "checkin" : need}" scope`);
  return { person, scopes, isSelf };
}

/** Notes are visible only to the reporter and to managers. */
export const canSeeNote = (viewerId: string, viewerScopes: Scope[], reporterUserId: string) =>
  viewerId === reporterUserId || viewerScopes.includes("manage");
