import { z } from "zod";
import { Contact, PlanState, Profile } from "@/lib/schema";

// Caregiver dashboard contract v1 (frozen spec). Kept here, not in schema.ts.
// Authority comes ONLY from grants; relationships, contacts and share links never grant access.

export const UserId = z.string().regex(/^[a-z0-9-]{3,40}$/, "User id must be 3-40 chars of a-z, 0-9, -");
export type UserId = z.infer<typeof UserId>;

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
export const TimeZone = z.string().min(1).max(64).refine(isValidTimeZone, "Unknown IANA time zone");

export const Scope = z.enum(["view", "checkin", "manage"]);
export type Scope = z.infer<typeof Scope>;
export const Scopes = z.array(Scope).min(1).transform((s) => [...new Set(s)]);

export const CheckInSchedule = z.object({ everyDays: z.number().int().min(1).max(14) });

export const Person = z.object({
  personId: z.uuid(),
  profile: Profile,
  timezone: TimeZone,
  selfUserId: UserId.optional(),
  checkInSchedule: CheckInSchedule.nullable(),
  createdAt: z.string(),
  createdBy: UserId,
  /** Current profile version (see PERSON_PROFILES.md). Absent on legacy rows = 1. */
  profileVersion: z.number().int().min(1).optional(),
});
export type Person = z.infer<typeof Person>;

export const Grant = z.object({
  personId: z.uuid(),
  userId: UserId,
  scopes: Scopes,
  grantedBy: UserId,
  grantedAt: z.string(),
  revokedAt: z.string().optional(),
});
export type Grant = z.infer<typeof Grant>;

export const PlanLink = z.object({
  personId: z.uuid(), planId: z.string(), linkedAt: z.string(), linkedBy: UserId,
  /** Person profile version the plan was created from. */
  profileVersion: z.number().int().min(1).optional(),
});
export type PlanLink = z.infer<typeof PlanLink>;

export const CheckInKind = z.enum(["ok", "call", "help"]);
export const CheckIn = z.object({
  checkInId: z.string(),
  personId: z.uuid(),
  kind: CheckInKind,
  planId: z.string().optional(),
  note: z.string().trim().min(1).max(280).optional(),
  reporterUserId: UserId,
  reporterRole: z.enum(["self", "caregiver"]),
  source: z.enum(["app", "demo"]),
  at: z.string(),
  idempotencyKey: z.string().min(1).max(80),
});
export type CheckIn = z.infer<typeof CheckIn>;

export const Ack = z.object({ itemId: z.string(), personId: z.uuid(), userId: UserId, at: z.string() });
export type Ack = z.infer<typeof Ack>;

// ─── Request bodies ───
export const CreatePersonInput = z.object({
  profile: Profile,
  timezone: TimeZone,
  selfUserId: UserId.optional(),
  checkInSchedule: CheckInSchedule.nullable().optional(),
});
export const GrantInput = z.object({ userId: UserId, scopes: Scopes });
export const CreatePersonPlanInput = z.object({
  activityId: z.string().min(1),
  contacts: z
    .array(Contact)
    .max(10)
    .default([])
    .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, "Contact ids must be unique")
    .refine((cs) => cs.every((c) => c.id !== "paratransit"), 'Contact id "paratransit" is reserved'),
});
export const CheckInInput = z.object({
  kind: CheckInKind,
  planId: z.string().min(1).optional(),
  note: z.string().trim().min(1).max(280).optional(),
  idempotencyKey: z.string().min(1).max(80),
});
export type CheckInInput = z.infer<typeof CheckInInput>;

// ─── Read models (derived on every read) ───
export type Labels = { storage: "memory" | "durable"; providers: "simulated"; generatedAt: string };

export type AttentionKind = "approval_needed" | "confirmation_pending" | "plan_disrupted" | "help_requested" | "call_requested" | "checkin_overdue";
export type AttentionItem = {
  itemId: string;
  kind: AttentionKind;
  personId: string;
  planId?: string;
  title: string;
  detail: string;
  createdAt: string;
  acknowledgedByMe: boolean;
};

export type Upcoming = { planId: string; activityName: string; slot: string; nextDate: string; timezone: string; state: z.infer<typeof PlanState> };

export type PlanSummary = {
  planId: string;
  activityName: string;
  when: string;
  state: z.infer<typeof PlanState>;
  version: number;
  // actionId is an opaque reference (the raw coordinator id embeds contact ids and equals the idempotency key)
  outstandingApprovals: { actionId: string; kind: "invite" | "ride"; description: string }[];
  dependencies: { kind: "invite" | "ride"; label: string; status: string }[];
  outcome?: { attended: boolean; source: "self_reported" };
  updatedAt: string;
};

export type CheckInView = {
  checkInId: string;
  kind: CheckIn["kind"];
  planId?: string;
  reporterRole: CheckIn["reporterRole"];
  source: CheckIn["source"];
  at: string;
  note?: string;
  hasNote?: true;
};

export type PersonSummary = {
  personId: string;
  displayName: string;
  timezone: string;
  nextActivity: Upcoming | null;
  attentionCount: number;
  latestCheckIn: { kind: CheckIn["kind"]; at: string; reporterRole: CheckIn["reporterRole"] } | null;
  myScopes: Scope[];
};

export type HistoryItem = {
  at: string;
  type: "plan_state" | "dependency" | "attendance" | "feedback" | "checkin";
  planId?: string;
  summary: string;
  checkIn?: CheckInView;
  // internal tiebreaker for the cursor; stripped before responding
  key: string;
};

// ─── Person profiles: versioned, confirmed updates (docs/daybridge/PERSON_PROFILES.md) ───
export const ProfileSource = z.enum(["create", "caregiver", "self", "intake", "feedback", "revert"]);
export type ProfileSource = z.infer<typeof ProfileSource>;

/** Append-only. unique(personId, version). */
export const ProfileVersion = z.object({
  personId: z.uuid(),
  version: z.number().int().min(1),
  profile: Profile,
  createdAt: z.string(),
  createdBy: UserId,
  source: ProfileSource,
  proposalId: z.string().optional(),
});
export type ProfileVersion = z.infer<typeof ProfileVersion>;

/** Per-field validation via Profile.shape; unknown fields rejected. */
export const ProfileChanges = Profile.partial().strict().refine((c) => Object.keys(c).length > 0, "changes must not be empty");
export type ProfileChanges = z.infer<typeof ProfileChanges>;

export const ProposalStatus = z.enum(["proposed", "confirmed", "rejected", "stale"]);
export const ProfileProposal = z.object({
  proposalId: z.string(),
  personId: z.uuid(),
  baseVersion: z.number().int().min(1),
  changes: ProfileChanges,
  evidence: z.string().trim().min(1).max(280),
  source: z.enum(["caregiver", "self", "intake", "feedback"]),
  proposedBy: UserId,
  /** Set when imported from a coordination plan's feedback patches. */
  planId: z.string().optional(),
  status: ProposalStatus,
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: UserId.optional(),
});
export type ProfileProposal = z.infer<typeof ProfileProposal>;

export const ProposeInput = z.object({
  changes: ProfileChanges,
  evidence: z.string().trim().min(1).max(280),
  source: z.enum(["caregiver", "self", "intake"]).optional(),
  baseVersion: z.number().int().min(1),
});
export const DecideInput = z.object({ expectedVersion: z.number().int().min(1) });
export const RevertInput = z.object({ toVersion: z.number().int().min(1), expectedVersion: z.number().int().min(1) });
