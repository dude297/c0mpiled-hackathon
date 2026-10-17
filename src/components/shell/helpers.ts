// Pure helpers for the device store (SCREENS.md "DS"). No React, no window: unit-tested in helpers.test.ts.
import { ACTIVITIES } from "@/domain/activities";
import { checkActivity } from "@/domain/engine";
import { AnalysisResult, CoordinationPlan, PlanItem, PlanState, Profile } from "@/lib/schema";

export type PersonKey = "me" | "margaret" | "harold";
export type Mode = "user" | "caregiver";
export type Active = { person: PersonKey; mode: Mode };
export type StoredResult = { result: AnalysisResult; profileHash: string };
export type PlanMap = Record<string, string>; // activityId → planId
/** An outing that was in the week but no longer fits after a re-plan (U2 heads-up). */
export type DroppedOuting = { activityId: string; name: string; reason: string | null };

export const PERSONS: readonly PersonKey[] = ["me", "margaret", "harold"];
export const DEFAULT_ACTIVE: Active = { person: "me", mode: "user" };
/** Golden-path handoff read by /coordinate and written by "/" on run. */
export const SESSION_PROFILE_KEY = "daybridge:profile";

export const KEYS = {
  active: "daybridge:v1:active",
  profile: (p: PersonKey) => `daybridge:v1:${p}:profile`,
  result: (p: PersonKey) => `daybridge:v1:${p}:result`,
  week: (p: PersonKey) => `daybridge:v1:${p}:week`,
  plans: (p: PersonKey) => `daybridge:v1:${p}:plans`,
} as const;

export const personKeys = (p: PersonKey) => [KEYS.profile(p), KEYS.result(p), KEYS.week(p), KEYS.plans(p)];

function json(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const isPerson = (v: unknown): v is PersonKey => typeof v === "string" && (PERSONS as readonly string[]).includes(v);

export function parseActive(raw: string | null): Active | null {
  const v = json(raw) as Partial<Active> | null;
  if (!v || typeof v !== "object" || !isPerson(v.person)) return null;
  return { person: v.person, mode: v.mode === "caregiver" ? "caregiver" : "user" };
}

export function parseProfile(raw: string | null): Profile | null {
  const r = Profile.safeParse(json(raw));
  return r.success ? r.data : null;
}

export function parseResult(raw: string | null): StoredResult | null {
  const v = json(raw) as { result?: unknown; profileHash?: unknown } | null;
  if (!v || typeof v.profileHash !== "string") return null;
  const r = AnalysisResult.safeParse(v.result);
  return r.success ? { result: r.data, profileHash: v.profileHash } : null;
}

/** null = never stored (first analyze adds every plan item). */
export function parseWeek(raw: string | null): string[] | null {
  const v = json(raw);
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : null;
}

export function parsePlans(raw: string | null): PlanMap {
  const v = json(raw);
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}

/** Order-insensitive hash of a profile; a cached result is reused only while this matches. */
export function profileHash(p: Profile): string {
  const s = JSON.stringify(stable(p));
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Week after an analyze: first analyze (prevWeek null) = every plan item; otherwise keep ids still in the plan.
 * Ids that fell out become heads-ups, named from the previous result, reason = first hard barrier in the new one.
 */
export function reconcileWeek(prevWeek: string[] | null, prev: AnalysisResult | null, next: AnalysisResult): { week: string[]; dropped: DroppedOuting[] } {
  const inPlan = new Set(next.plan.map((i) => i.activityId));
  if (prevWeek === null) return { week: [...inPlan], dropped: [] };
  const dropped = prevWeek
    .filter((id) => !inPlan.has(id))
    .map((id) => {
      const name = prev?.plan.find((i) => i.activityId === id)?.name ?? null;
      const hard = name ? next.blocked.find((b) => b.name === name)?.barriers.find((b) => b.severity === "hard") : undefined;
      return name ? { activityId: id, name, reason: hard?.detail ?? null } : null;
    })
    .filter((d): d is DroppedOuting => d !== null);
  return { week: prevWeek.filter((id) => inPlan.has(id)), dropped };
}

/**
 * The engine returns only its top 3 as `plan`. Every other activity that still fits (all checks pass) is appended,
 * best score first, so a looser answer never makes a chosen outing look like it "no longer fits" and Matches can list it.
 * Same scoring and route rule as src/domain/engine.ts.
 */
export function withAllMatches(profile: Profile, result: AnalysisResult): AnalysisResult {
  const have = new Set(result.plan.map((i) => i.activityId));
  const canWalk = profile.mobility === "full" || profile.mobility === "cane";
  const extra: PlanItem[] = ACTIVITIES.filter((a) => !have.has(a.id) && a.tags.some((t) => profile.interests.includes(t)))
    .flatMap((a) => {
      const checks = checkActivity(profile, a);
      if (!checks.every((c) => c.ok)) return [];
      const routes = profile.transport
        .filter((m) => m !== "walk" || canWalk)
        .flatMap((m) => (a.travelMin[m] === undefined ? [] : [{ mode: m, min: a.travelMin[m]! }]))
        .sort((x, y) => x.min - y.min || x.mode.localeCompare(y.mode));
      const fitting = routes.filter((r) => r.min <= profile.maxTravelMin);
      const route = fitting.find((r) => r.mode !== "family") ?? fitting[0] ?? routes[0];
      if (!route) return [];
      const barriers = checks.flatMap((c) => (c.barrier ? [c.barrier] : []));
      const matches = a.tags.filter((t) => profile.interests.includes(t)).length;
      const score = Math.round((10 * matches - 2 * barriers.length - route.min / 10) * 10) / 10;
      return [{ activityId: a.id, name: a.name, when: `${a.day} ${a.time}`, travel: `${route.mode}, ${route.min} min`, costPerWeek: a.costPerWeek, score, barriers }];
    })
    .sort((x, y) => y.score - x.score || x.activityId.localeCompare(y.activityId));
  return extra.length ? { ...result, plan: [...result.plan, ...extra] } : result;
}

export const toggleId = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// ─── Plan status (SCREENS.md "Plan status") ───

/** state null = Not started (no id, 404, CANCELLED). */
export type PlanStatus = { state: PlanState | null; planId: string | null; plan: CoordinationPlan | null };
export const NOT_STARTED: PlanStatus = { state: null, planId: null, plan: null };

export type FetchOutcome = { kind: "ok"; status: PlanStatus } | { kind: "gone" } | { kind: "unavailable" } | { kind: "error" };

/** Maps a GET /api/coordination/plans/:id response. 404 → gone (drop the id), 503 → live status unavailable. */
export function readPlanResponse(planId: string, httpStatus: number, body: unknown): FetchOutcome {
  if (httpStatus === 404) return { kind: "gone" };
  if (httpStatus === 503) return { kind: "unavailable" };
  if (httpStatus < 200 || httpStatus >= 300) return { kind: "error" };
  const full = CoordinationPlan.safeParse(body);
  const state = full.success ? full.data.state : PlanState.safeParse((body as { state?: unknown } | null)?.state).data;
  if (!state) return { kind: "error" };
  if (state === "CANCELLED") return { kind: "ok", status: NOT_STARTED };
  return { kind: "ok", status: { state, planId, plan: full.success ? full.data : null } };
}

export type StatusIcon = "alert" | "pending" | "waiting" | "check";
export type StatusView = {
  word: string;
  icon: StatusIcon | null;
  /** 0 = not attention; lower number = shown first (NEEDS_REPLAN, BLOCKED, AWAITING_APPROVAL). */
  attention: number;
  /** Label for the link/button to /coordinate; null = no action (Done). */
  action: string | null;
  /** true = resume the saved plan (&planId=), false = start a new one. */
  resume: boolean;
};

/** Words + icon for a plan state. Never shows raw state names. `name` is only used in caregiver mode. */
export function planStatusView(state: PlanState | null, mode: Mode = "user", name = "them"): StatusView {
  switch (state) {
    case "NEEDS_REPLAN": return { word: "Needs a new plan", icon: "alert", attention: 1, action: "Fix my plan", resume: true };
    case "BLOCKED": return { word: "Can't go as planned", icon: "alert", attention: 2, action: "See what's in the way", resume: true };
    case "AWAITING_APPROVAL": return { word: mode === "caregiver" ? `Needs ${name === "them" || name === "You" ? "their" : `${name}'s`} OK` : "Needs your OK", icon: "pending", attention: 3, action: "Continue my plan", resume: true };
    case "PROPOSED": return { word: "Plan started, not confirmed", icon: "pending", attention: 0, action: "Continue my plan", resume: true };
    case "PENDING_CONFIRMATION": return { word: "Waiting for replies", icon: "waiting", attention: 0, action: "See status", resume: true };
    case "READY": return { word: "Ready", icon: "check", attention: 0, action: "See plan", resume: true };
    case "COMPLETED": return { word: "Done", icon: "check", attention: 0, action: null, resume: false };
    default: return { word: "Not started", icon: null, attention: 0, action: "Get me there", resume: false };
  }
}

/** Link to X1. A planId is only passed when resuming. */
export function coordinateHref(activityId: string, planId?: string | null): string {
  const q = new URLSearchParams({ activityId });
  if (planId) q.set("planId", planId);
  return `/coordinate?${q.toString()}`;
}

export function friendlyAnalyzeError(httpStatus: number | null): string {
  if (httpStatus === null) return "We couldn't reach DayBridge. Check your connection and try again.";
  if (httpStatus === 400) return "Some of your answers need another look. Open Profile to check them.";
  return "Our planner is having a moment. Please try again.";
}
