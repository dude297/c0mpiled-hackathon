import { createHash } from "node:crypto";
import { currentActions, currentDeps } from "@/domain/coordination/coordinator";
import { PARATRANSIT_ID } from "@/domain/coordination/planner";
import type { CoordinationEvent, CoordinationPlan } from "@/lib/schema";
import { canSeeNote } from "./access";
import type { CheckIn, CheckInView, HistoryItem, PlanSummary, Scope } from "./contract";

// Minimal allowlist projections of coordinator data. Coordinator text that can embed contact names
// (action descriptions, dependency labels) is never copied; fixed labels are used instead.

export function safeActionLabel(kind: "invite" | "ride", recipientId: string | undefined) {
  if (kind === "invite") return "Invite a contact to come along";
  return recipientId === PARATRANSIT_ID ? "Paratransit ride" : "Ride from a contact";
}

/** Opaque, stable action reference (the raw id embeds contact ids and doubles as the idempotency key). */
export const opaqueActionId = (id: string) => "act_" + createHash("sha256").update(id).digest("hex").slice(0, 16);

export function safeDeps(p: CoordinationPlan) {
  return currentDeps(p).map((d) => ({
    kind: d.kind,
    label: safeActionLabel(d.kind, p.actions.find((a) => a.id === d.actionId)?.scope.recipientId),
    status: d.status,
  }));
}

export function planSummary(p: CoordinationPlan): PlanSummary {
  return {
    planId: p.id,
    activityName: p.activityName,
    when: p.when,
    state: p.state,
    version: p.version,
    outstandingApprovals: currentActions(p)
      .filter((a) => a.status === "proposed" || a.status === "revoked")
      .map((a) => ({ actionId: opaqueActionId(a.id), kind: a.scope.kind, description: safeActionLabel(a.scope.kind, a.scope.recipientId) })),
    dependencies: safeDeps(p),
    ...(p.outcome ? { outcome: { attended: p.outcome.attended, source: p.outcome.source } } : {}),
    updatedAt: p.updatedAt,
  };
}

export function checkInView(c: CheckIn, viewerId: string, viewerScopes: Scope[]): CheckInView {
  const v: CheckInView = { checkInId: c.checkInId, kind: c.kind, reporterRole: c.reporterRole, source: c.source, at: c.at };
  if (c.planId) v.planId = c.planId;
  if (c.note) {
    if (canSeeNote(viewerId, viewerScopes, c.reporterUserId)) v.note = c.note;
    else v.hasNote = true;
  }
  return v;
}

const DEP_STATUS: Record<string, string> = {
  requested: "requested", confirmed: "confirmed", accepted: "confirmed", cancelled: "cancelled", declined: "declined", failed: "failed",
};
const PLAN_STATE: Record<string, string> = {
  "plan.ready": "Plan is ready",
  "plan.ready_revoked": "Plan is no longer ready",
  "plan.replan_required": "Plan needs a new arrangement",
};

/** Applied coordinator events → history items. Rejected/duplicate/ignored events and every payload are dropped. */
export function projectEvents(planId: string, events: CoordinationEvent[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const e of events) {
    if (e.outcome !== "applied") continue;
    const key = `e|${planId}|${String(e.seq).padStart(8, "0")}`;
    const base = { at: e.at, planId, key };
    const [kind, verb] = e.type.split(".");
    if (PLAN_STATE[e.type]) out.push({ ...base, type: "plan_state", summary: PLAN_STATE[e.type] });
    else if (e.type === "plan.completed") out.push({ ...base, type: "attendance", summary: e.payload.attended === true ? "Attended (self-reported)" : "Did not attend (self-reported)" });
    else if (e.type === "preference.updated") out.push({ ...base, type: "feedback", summary: "Preferences updated from feedback" });
    else if ((kind === "ride" || kind === "invite") && DEP_STATUS[verb]) out.push({ ...base, type: "dependency", summary: `${kind === "ride" ? "Ride" : "Invite"}: ${DEP_STATUS[verb]}` });
  }
  return out;
}

export function projectCheckins(checkIns: CheckIn[], viewerId: string, viewerScopes: Scope[]): HistoryItem[] {
  return checkIns.map((c) => ({
    at: c.at,
    type: "checkin" as const,
    ...(c.planId ? { planId: c.planId } : {}),
    summary: `Check-in: ${c.kind} (${c.reporterRole})`,
    checkIn: checkInView(c, viewerId, viewerScopes),
    key: `c|${c.at}|${c.checkInId}`,
  }));
}

export const MAX_HISTORY_LIMIT = 50;
const encode = (at: string, seq: string) => Buffer.from(JSON.stringify([at, seq])).toString("base64url");
export function decodeCursor(cursor: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string" ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

const newestFirst = (a: { at: string; key: string }, b: { at: string; key: string }) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key);

/** Newest first, keyset pagination on (at, seq). `after` must come from decodeCursor. */
export function paginate(items: HistoryItem[], limit: number, after: [string, string] | null) {
  const sorted = [...items].sort(newestFirst);
  const rest = after ? sorted.filter((i) => newestFirst(i, { at: after[0], key: after[1] }) > 0) : sorted;
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((i) => {
      const out: Omit<HistoryItem, "key"> & { key?: string } = { ...i };
      delete out.key;
      return out;
    }),
    nextCursor: rest.length > limit && last ? encode(last.at, last.key) : null,
  };
}
