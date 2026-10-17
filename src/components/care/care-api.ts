import { z } from "zod";
import { Person, Scope, CheckInKind, type CheckInInput } from "@/domain/caregiver/contract";
import { PlanState, Profile } from "@/lib/schema";

const labels = z.object({ storage: z.enum(["memory", "durable"]), providers: z.literal("simulated"), generatedAt: z.string() });
const checkIn = z.object({
  checkInId: z.string(), kind: CheckInKind, planId: z.string().optional(),
  reporterRole: z.enum(["self", "caregiver"]), source: z.enum(["app", "demo"]), at: z.string(),
  note: z.string().optional(), hasNote: z.literal(true).optional(),
});
const upcoming = z.object({ planId: z.string(), activityName: z.string(), slot: z.string(), nextDate: z.string(), timezone: z.string(), state: PlanState });
const attention = z.object({
  itemId: z.string(), personId: z.string(), planId: z.string().optional(),
  kind: z.enum(["approval_needed", "confirmation_pending", "plan_disrupted", "help_requested", "call_requested", "checkin_overdue"]),
  title: z.string(), detail: z.string(), createdAt: z.string(), acknowledgedByMe: z.boolean(),
});
const plan = z.object({
  planId: z.string(), activityName: z.string(), when: z.string(), state: PlanState, version: z.number(),
  outstandingApprovals: z.array(z.object({ actionId: z.string(), kind: z.enum(["invite", "ride"]), description: z.string() })),
  dependencies: z.array(z.object({ kind: z.enum(["invite", "ride"]), label: z.string(), status: z.string() })),
  outcome: z.object({ attended: z.boolean(), source: z.literal("self_reported") }).optional(), updatedAt: z.string(),
});
export const Overview = z.object({
  people: z.array(z.object({
    personId: z.string(), displayName: z.string(), timezone: z.string(), nextActivity: upcoming.nullable(),
    attentionCount: z.number(), latestCheckIn: checkIn.pick({ kind: true, at: true, reporterRole: true }).nullable(), myScopes: z.array(Scope),
  })), labels,
});
export const PersonDetail = z.object({ person: Person, plans: z.array(plan), upcoming: z.array(upcoming), attention: z.array(attention), latestCheckIns: z.array(checkIn), myScopes: z.array(Scope), labels });
export type PersonDetail = z.infer<typeof PersonDetail>;
export type CareLabels = z.infer<typeof labels>;
export const History = z.object({
  items: z.array(z.object({ at: z.string(), type: z.enum(["plan_state", "dependency", "attendance", "feedback", "checkin"]), planId: z.string().optional(), summary: z.string(), checkIn: checkIn.optional() })),
  nextCursor: z.string().nullable(), labels,
});
export type History = z.infer<typeof History>;
const savedCheckIn = z.object({ checkIn, duplicate: z.boolean(), labels });
const acked = z.object({ itemId: z.string(), acknowledgedByMe: z.literal(true), labels });

export class CareApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "CareApiError"; }
}

/** An authorization failure must never unlock the device-store fallback. */
export function canUseDeviceFallback(error: unknown) {
  return error instanceof CareApiError && (error.status === 0 || error.status === 503);
}

export function isAccessError(error: unknown) {
  return error instanceof CareApiError && [401, 403, 404].includes(error.status);
}

/** Keep the same key after an ambiguous network failure; editing the form starts a new submission. */
export class CheckInDraft {
  private previous: { payload: string; key: string } | null = null;
  constructor(private readonly newKey: () => string = () => crypto.randomUUID()) {}
  submission(kind: CheckInInput["kind"], note: string): CheckInInput {
    const fields = { kind, ...(note.trim() ? { note: note.trim() } : {}) };
    const payload = JSON.stringify(fields);
    if (!this.previous || this.previous.payload !== payload) this.previous = { payload, key: this.newKey() };
    return { ...fields, idempotencyKey: this.previous.key };
  }
  saved() { this.previous = null; }
}

export function careErrorMessage(error: unknown) {
  if (!(error instanceof CareApiError)) return "Couldn't load. Retry.";
  if (error.status === 401) return "Choose a demo identity to continue.";
  if (error.status === 403) return "You can view but not do this. Ask a manager for access.";
  if (error.status === 404) return "Person not found or not shared with you.";
  if (error.status === 409) return error.message;
  if (error.status === 503) return "The caregiver dashboard is available in the local demo only. It needs sign-in and storage.";
  return "Couldn't load. Retry.";
}

/** Injectable fetch keeps the UI boundary testable without a server or real provider calls. */
export function createCareApi(identity: string, fetcher: typeof fetch = fetch) {
  async function request<T extends z.ZodType>(path: string, schema: T, init: RequestInit = {}): Promise<z.infer<T>> {
    let response: Response;
    try {
      response = await fetcher(`/api/caregiver${path}`, {
        ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
        cache: "no-store", headers: { "x-daybridge-user": identity, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new CareApiError(0, "Couldn't load. Retry.");
    }
    let value: unknown;
    try { value = await response.json(); } catch { throw new CareApiError(response.ok ? 502 : response.status, "Invalid server response"); }
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(value);
      throw new CareApiError(response.status, parsed.success ? parsed.data.error : "Request failed");
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new CareApiError(502, "Invalid server response");
    return parsed.data;
  }
  return {
    overview: (signal?: AbortSignal) => request("/overview", Overview, { signal }),
    person: (id: string, signal?: AbortSignal) => request(`/people/${encodeURIComponent(id)}`, PersonDetail, { signal }),
    profile: (id: string, signal?: AbortSignal) => request(`/people/${encodeURIComponent(id)}/profile`, z.object({ profile: Profile, version: z.number(), labels }), { signal }),
    history: (id: string, cursor?: string, signal?: AbortSignal) => request(`/people/${encodeURIComponent(id)}/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, History, { signal }),
    checkIn: (id: string, body: CheckInInput) => request(`/people/${encodeURIComponent(id)}/checkins`, savedCheckIn, { method: "POST", body: JSON.stringify(body) }),
    acknowledge: (itemId: string) => request(`/attention/${encodeURIComponent(itemId)}/ack`, acked, { method: "POST" }),
    seedDemo: () => request("/demo", z.object({ labels }), { method: "POST" }),
  };
}

export function dependencyStatus(status: string) {
  const names: Record<string, string> = { not_requested: "Not requested yet", requested: "Requested, not confirmed yet", confirmed: "Confirmed", declined: "Declined", cancelled: "Cancelled", failed: "Failed" };
  return names[status] ?? "Unknown";
}

export function readableDate(value: string, timezone: string, dateOnly = false) {
  // A calendar date is not an instant; noon UTC avoids parsing it as yesterday in US time zones.
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.valueOf())) return "Date not set";
  return new Intl.DateTimeFormat("en-US", { timeZone: dateOnly ? "UTC" : timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit" }) }).format(date);
}
