import { ACTIVITIES, type Activity } from "@/domain/activities";
import {
  COORDINATION_CONTRACT_VERSION,
  type ActionRequest,
  type ActionScope,
  type CommandResult,
  type CoordinationEvent,
  type CoordinationPlan,
  type Contact,
  type Profile,
  type Dependency,
  type PlanCommand,
  type ProviderEvent,
} from "@/lib/schema";
import { alternativesFor, patchesFromFeedback, propose, whenOf, type Exclusions } from "./planner";
import type { ProviderPort } from "./provider";
import { createMemoryStore, type CoordinationStore, type StoredPlan } from "./store";

// Deterministic coordination state machine. Every transition is decided here from user commands
// and provider evidence; AI output never reaches this module.

export const MAX_APPROVAL_MS = 24 * 60 * 60 * 1000;
export const PROVIDER_TIMEOUT_MS = 10_000;
const TERMINAL_DEP = new Set<Dependency["status"]>(["declined", "cancelled", "failed"]);
const CLOSED_PLAN = new Set<CoordinationPlan["state"]>(["COMPLETED", "CANCELLED"]);

export type CoordinatorDeps = {
  provider: ProviderPort;
  now?: () => Date;
  activities?: Activity[];
  newId?: () => string;
  store?: CoordinationStore;
};

export const MAX_COMMIT_ATTEMPTS = 3;
// Abuse ceiling: every command appends at least one event, so this caps writes (and load size) per plan.
export const MAX_LOG_EVENTS = 500;

type Entry = StoredPlan;
// Trusted server-side caller (signed provider callbacks). Accepted only by ingest(); user routes pass a userId/null,
// which can never equal this object, so no user path gains owner bypass.
export type SystemCaller = { system: true };
type Caller = string | null | undefined | SystemCaller;
const isSystem = (c: Caller): c is SystemCaller => typeof c === "object" && c !== null && c.system === true;
type Pending = Omit<CoordinationEvent, "seq" | "at">;

export class CoordinationError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string) {
    super(message);
  }
}

export function sameScope(a: ActionScope, b: ActionScope) {
  const fields = (s: ActionScope) => JSON.stringify([...s.sharedFields].sort());
  return a.kind === b.kind && a.activityId === b.activityId && a.recipientId === b.recipientId && a.when === b.when && fields(a) === fields(b);
}

export const currentActions = (p: CoordinationPlan) => p.actions.filter((a) => a.status !== "superseded");
export const currentDeps = (p: CoordinationPlan) => {
  const ids = new Set(currentActions(p).map((a) => a.id));
  return p.dependencies.filter((d) => ids.has(d.actionId));
};

// READY invariant: every current action was dispatched under a matching, unrevoked user approval,
// and every dependency has provider/participant confirmation. Returns the reasons it does not hold.
export function readyViolations(p: CoordinationPlan): string[] {
  const out: string[] = [];
  if (p.blockers.length) out.push("plan has unresolved blockers");
  for (const a of currentActions(p)) {
    const appr = p.approvals.find((x) => x.id === a.approvalId);
    if (a.status !== "dispatched") out.push(`${a.id} not dispatched (${a.status})`);
    if (!appr || appr.revoked || appr.actionId !== a.id || !sameScope(appr.scope, a.scope)) out.push(`${a.id} has no matching approval`);
  }
  for (const d of currentDeps(p)) if (d.status !== "confirmed") out.push(`${d.id} is ${d.status}`);
  return out;
}

// Dispatched and not closed by the provider: someone was asked and may still act on it.
function isLive(p: CoordinationPlan, a: ActionRequest) {
  const d = p.dependencies.find((x) => x.actionId === a.id);
  return !!a.providerRequestId && a.status !== "failed" && !!d && !TERMINAL_DEP.has(d.status);
}

export function createCoordinator(deps: CoordinatorDeps) {
  const now = deps.now ?? (() => new Date());
  const catalog = deps.activities ?? ACTIVITIES;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const store = deps.store ?? createMemoryStore();
  const locks = new Map<string, Promise<unknown>>();

  // Per-plan promise chain: avoids pointless CAS conflicts inside one process. The store's CAS (rev) is the cross-instance guarantee.
  function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    locks.set(id, tail);
    void tail.then(() => locks.get(id) === tail && locks.delete(id));
    return next;
  }

  const activityOf = (id: string) => {
    const a = catalog.find((x) => x.id === id);
    if (!a) throw new CoordinationError(400, `Unknown activity "${id}"`);
    return a;
  };

  function record(e: Entry, events: Pending[]): CoordinationEvent[] {
    const at = now().toISOString();
    const out = events.map((ev, i) => ({ ...ev, seq: e.log.length + i + 1, at }));
    e.log.push(...out);
    e.plan.updatedAt = at;
    return out;
  }

  function done(e: Entry, events: Pending[], outcome: CommandResult["outcome"] = "applied", reason?: string): CommandResult {
    const recorded = record(e, events);
    return structuredClone({ plan: e.plan, outcome, reason, events: recorded });
  }

  const reject = (e: Entry, type: string, actor: Pending["actor"], reason: string, payload: Record<string, unknown> = {}) =>
    done(e, [{ type, actor, outcome: "rejected", reason, payload }], "rejected", reason);

  // (Re)compute interventions for an activity. Confirmed dependencies with an identical scope carry over;
  // everything else from earlier versions is superseded and needs fresh approval.
  function plan(e: Entry, activity: Activity, ex: Exclusions): Pending[] {
    const p = e.plan;
    p.version += 1;
    p.activityId = activity.id;
    p.activityName = activity.name;
    p.when = whenOf(activity);
    const prop = propose(p.profile, activity, p.contacts, ex);
    const keep = new Set<string>();
    p.interventions = [];
    p.blockers = prop.blockers;

    if (prop.feasible) {
      p.interventions = prop.interventions.map((iv) => ({ ...iv }));
      for (const pa of prop.actions) {
        // Never re-send to someone already asked: keep live requests (requested/confirmed) and approved actions
        // whose dispatch outcome is unknown (provider error), with their original idempotency key.
        const carried = currentActions(p).find((a) => {
          const st = p.dependencies.find((d) => d.actionId === a.id)?.status;
          return sameScope(a.scope, pa.scope) && (st === "confirmed" || st === "requested" || (a.status === "approved" && a.dispatchError === true));
        });
        const iv = p.interventions.find((x) => x.id === pa.interventionId)!;
        if (carried) {
          keep.add(carried.id);
          iv.actionId = carried.id;
          continue;
        }
        const id = `${p.id}:v${p.version}:${pa.scope.kind}:${pa.scope.recipientId}`;
        const action: ActionRequest = { id, interventionId: pa.interventionId, planVersion: p.version, scope: pa.scope, description: pa.description, status: "proposed", idempotencyKey: id };
        p.actions.push(action);
        p.dependencies.push({ id: `dep:${id}`, actionId: id, kind: pa.scope.kind, label: pa.description, status: "not_requested", lastSequence: 0 });
        keep.add(id);
        iv.actionId = id;
      }
    }
    const superseded: string[] = [];
    const toNotify: string[] = [];
    for (const a of p.actions) if (a.status !== "superseded" && !keep.has(a.id)) {
      if (isLive(p, a)) toNotify.push(a.id);
      a.status = "superseded";
      superseded.push(a.id);
    }
    p.alternatives = alternativesFor(p.profile, catalog, activity.id, p.contacts);
    const events: Pending[] = [];
    if (superseded.length) events.push({ type: "actions.superseded", actor: "agent", outcome: "applied", payload: { actionIds: superseded, dispatchedActionsToNotify: toNotify } });
    events.push(
      prop.feasible
        ? { type: "plan.proposed", actor: "agent", outcome: "applied", payload: { version: p.version, activityId: activity.id, actions: currentActions(p).map((a) => a.id) } }
        : { type: "plan.blocked", actor: "agent", outcome: "applied", payload: { version: p.version, activityId: activity.id, blockers: prop.blockers.map((b) => b.detail) } },
    );
    return events;
  }

  function exclusions(p: CoordinationPlan): Exclusions {
    const recipients = new Set<string>();
    for (const d of p.dependencies) {
      const a = p.actions.find((x) => x.id === d.actionId);
      if (a && (TERMINAL_DEP.has(d.status) || a.status === "failed")) recipients.add(a.scope.recipientId);
    }
    return { recipients };
  }

  // After dispatch or provider evidence: READY only if the invariant holds; any failed dependency forces a replan.
  function settle(e: Entry): Pending[] {
    const p = e.plan;
    if (CLOSED_PLAN.has(p.state)) return [];
    const failed = currentDeps(p).filter((d) => TERMINAL_DEP.has(d.status));
    if (failed.length) {
      const wasReady = p.state === "READY";
      const events: Pending[] = [];
      if (wasReady) events.push({ type: "plan.ready_revoked", actor: "agent", outcome: "applied", payload: { because: failed.map((d) => `${d.label}: ${d.status}`) } });
      events.push(...plan(e, activityOf(p.activityId), exclusions(p)));
      p.state = "NEEDS_REPLAN";
      events.push({ type: "plan.replan_required", actor: "agent", outcome: "applied", payload: { failed: failed.map((d) => d.id), recoveryFeasible: p.blockers.length === 0 } });
      return events;
    }
    if (p.state !== "PENDING_CONFIRMATION" && p.state !== "READY") return [];
    if (readyViolations(p).length === 0) {
      if (p.state !== "READY") {
        p.state = "READY";
        return [{ type: "plan.ready", actor: "agent", outcome: "applied", payload: { version: p.version } }];
      }
      return [];
    }
    p.state = "PENDING_CONFIRMATION";
    return [];
  }

  // A wrong owner gets the same 404 as a missing plan, so plan ids leak nothing.
  async function entry(id: string, ownerId: Caller) {
    const e = await store.load(id);
    if (!e || (!isSystem(ownerId) && e.ownerId !== (ownerId ?? null))) throw new CoordinationError(404, `Plan "${id}" not found`);
    return e;
  }

  // load -> run the transition on the private copy -> CAS commit of the events/keys added in this call.
  // On a lost race, reload and rerun the whole attempt, unless the attempt called a provider: an external side
  // effect is never re-run automatically. That surfaces as 409 and the user retries execute; the action stays
  // approved and reuses its idempotencyKey. ponytail: at-least-once dispatch, safe for the key-deduping mock only;
  // live providers need a two-phase claim (commit "dispatching" first, then call) before they can be wired in.
  const dispatchedIn = new WeakSet<Entry>();
  function mutate(id: string, ownerId: Caller, fn: (e: Entry) => Promise<CommandResult>): Promise<CommandResult> {
    return withLock(id, async () => {
      for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
        const e = await entry(id, ownerId);
        if (e.log.length >= MAX_LOG_EVENTS) throw new CoordinationError(429, "This plan has reached its activity limit; start a new plan");
        const logLen = e.log.length;
        const keyCount = e.seenKeys.size;
        const result = await fn(e);
        // Sets keep insertion order, so keys added in this call are the tail.
        if (await store.commit(id, e.rev, e.plan, e.log.slice(logLen), [...e.seenKeys].slice(keyCount))) return result;
        if (dispatchedIn.has(e)) throw new CoordinationError(409, "Plan changed while dispatching; refresh and retry");
      }
      throw new CoordinationError(409, "Plan changed concurrently; retry");
    });
  }

  async function create(input: { profile: Profile; activityId: string; contacts?: Contact[] }, ownerId?: string | null): Promise<CommandResult> {
    const activity = activityOf(input.activityId);
    const at = now().toISOString();
    const id = newId();
    const e: Entry = {
      plan: {
        id, contractVersion: COORDINATION_CONTRACT_VERSION, version: 0, state: "PROPOSED",
        profile: structuredClone(input.profile), profileVersion: 1, contacts: (input.contacts ?? []).map((c) => ({ ...c, canDrive: c.canDrive ?? false })),
        activityId: activity.id, activityName: activity.name, when: whenOf(activity),
        blockers: [], interventions: [], actions: [], dependencies: [], approvals: [], alternatives: [], preferencePatches: [],
        dataSource: deps.provider.dataSource, createdAt: at, updatedAt: at,
      },
      log: [], seenKeys: new Set(), rev: 0, ownerId: ownerId ?? null,
    };
    const events: Pending[] = [{ type: "plan.created", actor: "user", outcome: "applied", payload: { activityId: activity.id } }, ...plan(e, activity, { recipients: new Set() })];
    e.plan.state = e.plan.blockers.length ? "BLOCKED" : "PROPOSED";
    const result = done(e, events);
    await store.create({ plan: e.plan, log: e.log, seenKeys: e.seenKeys, ownerId: e.ownerId });
    return result;
  }

  function command(id: string, cmd: PlanCommand, ownerId?: string | null): Promise<CommandResult> {
    return mutate(id, ownerId, async (e) => {
      const p = e.plan;
      const type = `command.${cmd.type}`;
      if (CLOSED_PLAN.has(p.state) && !["feedback", "confirm_preference", "reject_preference"].includes(cmd.type))
        return reject(e, type, "user", `Plan is ${p.state}`);

      switch (cmd.type) {
        case "accept_proposal": {
          if (p.state !== "PROPOSED" && p.state !== "NEEDS_REPLAN") return reject(e, type, "user", `Cannot accept a proposal in ${p.state}`);
          if (p.blockers.length) return reject(e, type, "user", "No feasible proposal to accept; choose an alternative or cancel");
          const needApproval = currentActions(p).some((a) => a.status === "proposed" || a.status === "revoked");
          const events: Pending[] = [{ type, actor: "user", outcome: "applied", payload: { version: p.version } }];
          if (needApproval) p.state = "AWAITING_APPROVAL";
          else {
            p.state = "PENDING_CONFIRMATION"; // nothing new to send; settle decides READY from existing evidence
            events.push(...settle(e));
          }
          return done(e, events);
        }

        case "approve": {
          if (p.state !== "AWAITING_APPROVAL") return reject(e, type, "user", `Approvals are only accepted in AWAITING_APPROVAL (plan is ${p.state})`, { actionId: cmd.actionId });
          const a = currentActions(p).find((x) => x.id === cmd.actionId);
          if (!a) return reject(e, type, "user", "Unknown or superseded action", { actionId: cmd.actionId });
          if (!sameScope(a.scope, cmd.scope)) return reject(e, type, "user", "Approval scope does not match the proposed action", { actionId: a.id });
          const t = now().getTime();
          const exp = Date.parse(cmd.expiresAt);
          if (exp <= t) return reject(e, type, "user", "Approval is already expired", { actionId: a.id });
          if (exp - t > MAX_APPROVAL_MS) return reject(e, type, "user", "Approval window exceeds 24 hours", { actionId: a.id });
          if (a.status === "approved") return done(e, [{ type, actor: "user", outcome: "duplicate", payload: { actionId: a.id } }], "duplicate");
          if (a.status !== "proposed" && a.status !== "revoked") return reject(e, type, "user", `Action is ${a.status}`, { actionId: a.id });
          const approvalId = `${a.id}:approval:${p.approvals.filter((x) => x.actionId === a.id).length + 1}`;
          p.approvals.push({ id: approvalId, actionId: a.id, scope: structuredClone(a.scope), approvedBy: "user", approvedAt: new Date(t).toISOString(), expiresAt: new Date(exp).toISOString(), revoked: false });
          a.status = "approved";
          a.approvalId = approvalId;
          return done(e, [{ type: "action.approved", actor: "user", outcome: "applied", payload: { actionId: a.id, approvalId, scope: a.scope, expiresAt: cmd.expiresAt } }]);
        }

        case "revoke": {
          const a = currentActions(p).find((x) => x.id === cmd.actionId);
          if (!a) return reject(e, type, "user", "Unknown or superseded action");
          if (a.status !== "approved") return reject(e, type, "user", a.status === "dispatched" ? "Already sent; cancel the plan instead" : `Action is ${a.status}`);
          a.status = "revoked";
          const appr = p.approvals.find((x) => x.id === a.approvalId);
          if (appr) appr.revoked = true;
          a.approvalId = undefined;
          if (p.state !== "AWAITING_APPROVAL") p.state = "AWAITING_APPROVAL";
          return done(e, [{ type: "action.revoked", actor: "user", outcome: "applied", payload: { actionId: a.id } }]);
        }

        case "execute": {
          if (p.state === "PENDING_CONFIRMATION" || p.state === "READY") return done(e, [{ type, actor: "user", outcome: "duplicate", payload: {} }], "duplicate", "Already dispatched");
          if (p.state !== "AWAITING_APPROVAL") return reject(e, type, "user", `Cannot execute in ${p.state}`);
          const t = now().getTime();
          const todo = currentActions(p).filter((a) => a.status !== "dispatched" && a.status !== "failed");
          // Atomic precheck: nothing is sent unless every pending action has a valid approval right now.
          const invalid = todo.flatMap((a) => {
            const appr = p.approvals.find((x) => x.id === a.approvalId);
            if (a.status !== "approved" || !appr) return [`${a.id}: not approved`];
            if (appr.revoked) return [`${a.id}: approval revoked`];
            if (Date.parse(appr.expiresAt) <= t) return [`${a.id}: approval expired`];
            if (!sameScope(appr.scope, a.scope)) return [`${a.id}: approval scope mismatch`];
            return [];
          });
          if (invalid.length) {
            for (const a of todo) if (a.status === "approved" && invalid.some((m) => m.startsWith(`${a.id}: approval expired`))) {
              a.status = "proposed";
              a.approvalId = undefined;
            }
            return reject(e, type, "user", `Not dispatched: ${invalid.join("; ")}`, { invalid });
          }
          const events: Pending[] = [];
          let providerErrors = 0;
          for (const a of todo) {
            const dep = p.dependencies.find((d) => d.actionId === a.id)!;
            const input = { planId: p.id, actionId: a.id, recipientId: a.scope.recipientId, approvalId: a.approvalId!, idempotencyKey: a.idempotencyKey, sharedFields: [...a.scope.sharedFields], when: a.scope.when };
            try {
              dispatchedIn.add(e);
              const call = a.scope.kind === "invite" ? deps.provider.sendApprovedInvite(input) : deps.provider.requestApprovedRide(input);
              // A hung provider must not hold the plan lock forever; a timeout is an unknown outcome like any error.
              let timer: ReturnType<typeof setTimeout> | undefined;
              const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("Provider timed out")), PROVIDER_TIMEOUT_MS)));
              const res = await Promise.race([call, timeout]).finally(() => clearTimeout(timer));
              a.dispatchError = undefined;
              a.providerRequestId = res.requestId;
              if (res.status === "requested") {
                a.status = "dispatched";
                dep.status = "requested";
                events.push({ type: `${a.scope.kind}.requested`, actor: "agent", outcome: "applied", idempotencyKey: a.idempotencyKey, payload: { actionId: a.id, requestId: res.requestId, dataSource: deps.provider.dataSource } });
              } else {
                a.status = "failed";
                dep.status = "failed";
                events.push({ type: `${a.scope.kind}.failed`, actor: "provider", outcome: "applied", idempotencyKey: a.idempotencyKey, reason: res.reason, payload: { actionId: a.id, requestId: res.requestId } });
              }
            } catch (err) {
              // Unknown whether it was sent: keep it approved; retry is safe because the idempotency key is stable.
              providerErrors++;
              a.dispatchError = true;
              events.push({ type: `${a.scope.kind}.dispatch_error`, actor: "agent", outcome: "rejected", reason: err instanceof Error ? err.message : "Provider error", payload: { actionId: a.id, retrySafe: true } });
            }
          }
          // Unknown outcomes: stay in AWAITING_APPROVAL (no replan, no re-send) until a retry resolves them.
          if (!providerErrors) {
            p.state = "PENDING_CONFIRMATION";
            events.push(...settle(e));
          }
          return done(e, events, providerErrors && p.state === "AWAITING_APPROVAL" ? "rejected" : "applied", providerErrors ? "Some actions could not reach the provider; retry execute" : undefined);
        }

        case "choose_alternative": {
          if (!["BLOCKED", "PROPOSED", "NEEDS_REPLAN"].includes(p.state)) return reject(e, type, "user", `Cannot switch activity in ${p.state}`);
          if (!p.alternatives.some((x) => x.activityId === cmd.activityId)) return reject(e, type, "user", "Not one of the offered alternatives");
          const events: Pending[] = [{ type, actor: "user", outcome: "applied", payload: { activityId: cmd.activityId } }, ...plan(e, activityOf(cmd.activityId), exclusions(p))];
          p.state = p.blockers.length ? "BLOCKED" : "PROPOSED";
          return done(e, events);
        }

        case "complete": {
          if (p.state !== "READY") return reject(e, type, "user", "Only a READY plan can be completed");
          p.state = "COMPLETED";
          p.outcome = { attended: cmd.attended, source: "self_reported" };
          return done(e, [{ type: "plan.completed", actor: "user", outcome: "applied", payload: { attended: cmd.attended, source: "self_reported" } }]);
        }

        case "cancel": {
          p.state = "CANCELLED";
          const open = p.actions.filter((a) => isLive(p, a)).map((a) => a.id);
          // No stale consent survives cancellation: approved-but-unsent actions lose their approval.
          const revokedActionIds: string[] = [];
          for (const a of p.actions) if (a.status === "approved") {
            const appr = p.approvals.find((x) => x.id === a.approvalId);
            if (appr) appr.revoked = true;
            a.status = "revoked";
            a.approvalId = undefined;
            revokedActionIds.push(a.id);
          }
          return done(e, [{ type: "plan.cancelled", actor: "user", outcome: "applied", payload: { dispatchedActionsToNotify: open, revokedActionIds } }]);
        }

        case "feedback": {
          if (p.state !== "COMPLETED") return reject(e, type, "user", "Feedback is accepted after completion");
          const patches = patchesFromFeedback(p.profile, cmd.signals, p.activityName);
          const added = patches.map((x, i) => ({ ...x, id: `${p.id}:patch:${p.preferencePatches.length + i + 1}` }));
          p.preferencePatches.push(...added);
          return done(e, [{ type: "feedback.preference_proposed", actor: "agent", outcome: "applied", payload: { signals: cmd.signals, patchIds: added.map((x) => x.id) } }]);
        }

        case "confirm_preference":
        case "reject_preference": {
          const patch = p.preferencePatches.find((x) => x.id === cmd.patchId);
          if (!patch) return reject(e, type, "user", "Unknown patch");
          if (patch.status !== "proposed") return done(e, [{ type, actor: "user", outcome: "duplicate", payload: { patchId: patch.id } }], "duplicate");
          if (cmd.type === "reject_preference") {
            patch.status = "rejected";
            return done(e, [{ type: "preference.rejected", actor: "user", outcome: "applied", payload: { patchId: patch.id } }]);
          }
          if (p.profile[patch.field] !== patch.from) return reject(e, type, "user", `Stale patch: ${patch.field} changed since it was proposed`);
          (p.profile as Record<string, unknown>)[patch.field] = patch.to;
          p.profileVersion += 1;
          patch.status = "applied";
          return done(e, [{ type: "preference.updated", actor: "user", outcome: "applied", payload: { patchId: patch.id, field: patch.field, from: patch.from, to: patch.to, profileVersion: p.profileVersion } }]);
        }
      }
    });
  }

  function ingest(id: string, ev: ProviderEvent, ownerId?: string | null | SystemCaller): Promise<CommandResult> {
    return mutate(id, ownerId, async (e) => {
      const p = e.plan;
      const type = ev.type;
      const base = { type, actor: ev.actor, idempotencyKey: ev.idempotencyKey, payload: { eventId: ev.eventId, requestId: ev.requestId, sequence: ev.sequence } } as const;
      const keys = [`event:${ev.eventId}`, ...(ev.idempotencyKey ? [`key:${ev.idempotencyKey}`] : [])];
      if (keys.some((k) => e.seenKeys.has(k))) return done(e, [{ ...base, outcome: "duplicate", reason: "Already processed" }], "duplicate", "Already processed");
      // Only valid callbacks burn their keys, so a forged or mistyped event cannot pre-empt the real one.
      const burn = () => keys.forEach((k) => e.seenKeys.add(k));

      const ignore = (reason: string) => {
        burn();
        return done(e, [{ ...base, outcome: "ignored", reason }], "ignored", reason);
      };
      const action = p.actions.find((a) => a.providerRequestId === ev.requestId);
      if (!action) return reject(e, type, ev.actor, "Unknown request id (nothing was dispatched for it)", base.payload);
      if (!type.startsWith(`${action.scope.kind}.`)) return reject(e, type, ev.actor, `Event type does not match a ${action.scope.kind} request`, base.payload);
      if (action.status === "superseded") return ignore("Request belongs to a superseded plan version");
      if (CLOSED_PLAN.has(p.state)) return ignore(`Plan is ${p.state}`);
      const dep = p.dependencies.find((d) => d.actionId === action.id)!;
      if (ev.sequence <= dep.lastSequence) return ignore(`Stale or out-of-order (sequence ${ev.sequence} <= ${dep.lastSequence})`);
      if (TERMINAL_DEP.has(dep.status)) return ignore(`Dependency already ${dep.status}`);

      const next: Dependency["status"] = type.endsWith("accepted") || type.endsWith("confirmed") ? "confirmed" : type.endsWith("declined") ? (dep.status === "confirmed" ? "cancelled" : "declined") : "cancelled";
      burn();
      dep.status = next;
      dep.lastSequence = ev.sequence;
      const events: Pending[] = [{ ...base, outcome: "applied", payload: { ...base.payload, dependencyId: dep.id, status: next, dataSource: p.dataSource } }];
      events.push(...settle(e));
      return done(e, events);
    });
  }

  async function get(id: string, ownerId?: string | null): Promise<{ plan: CoordinationPlan; events: CoordinationEvent[] }> {
    const e = await entry(id, ownerId); // already a private copy
    return { plan: e.plan, events: e.log };
  }

  return { create, command, ingest, get };
}

export type Coordinator = ReturnType<typeof createCoordinator>;
