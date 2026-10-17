import { z } from "zod";

// Contract between UI, API route, domain engine and AI adapter.

export const Interest = z.enum(["gardening", "music", "cards", "walking", "crafts", "faith", "learning", "volunteering", "cooking", "tech"]);
export const TimeSlot = z.enum(["morning", "afternoon", "evening"]);
export const Transport = z.enum(["drive", "bus", "paratransit", "family", "walk"]);
export const Mobility = z.enum(["full", "cane", "walker", "wheelchair"]);

export const Profile = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  interests: z.array(Interest).min(1, "Pick at least one interest"),
  mobility: Mobility,
  transport: z.array(Transport).min(1, "Pick at least one way to get there"),
  maxTravelMin: z.number().int().min(5).max(120),
  times: z.array(TimeSlot).min(1, "Pick at least one time of day"),
  budgetPerWeek: z.number().min(0).max(500),
  hearingImpaired: z.boolean(),
  prefersSmallGroups: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;

export const ScenarioInput = z.object({ profile: Profile });
export type ScenarioInput = z.infer<typeof ScenarioInput>;

export const Evidence = z.object({
  claim: z.string(),
  source: z.string(),
  verified: z.boolean(),
});
export type Evidence = z.infer<typeof Evidence>;

// hard = makes the activity infeasible; soft = feasible with a mitigation.
export const Barrier = z.object({
  rule: z.string(),
  severity: z.enum(["hard", "soft"]),
  detail: z.string(),
  mitigation: z.string().optional(),
});
export type Barrier = z.infer<typeof Barrier>;

export const PlanItem = z.object({
  activityId: z.string(),
  name: z.string(),
  when: z.string(),
  travel: z.string(),
  costPerWeek: z.number(),
  score: z.number(),
  barriers: z.array(Barrier),
});
export type PlanItem = z.infer<typeof PlanItem>;

export const AnalysisResult = z.object({
  summary: z.string(),
  items: z.array(z.object({ label: z.string(), value: z.string() })),
  plan: z.array(PlanItem),
  blocked: z.array(z.object({ name: z.string(), barriers: z.array(Barrier) })),
  evidence: z.array(Evidence),
  explanation: z.string(),
  // "mock" = canned explanation, "live" = real model. Always shown in UI.
  dataSource: z.enum(["mock", "live"]),
  // Optional third-party enrichment (see ENRICHMENT_CONTRACT.md). Getters: schemas are defined at the end of this file.
  get venueByItem() { return z.record(z.string(), VenueInfo).optional(); },
  get weather() { return WeatherNote.optional(); },
  get rideshareByItem() { return z.record(z.string(), z.array(RideshareOption)).optional(); },
  get enrichment() { return EnrichmentMeta.optional(); },
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

// ─── Coordination contract v1 (additive; see docs/daybridge/COORDINATION_CONTRACT.md) ───
// Deterministic state lives in src/domain/coordination. AI may explain it; it never confirms, approves or transitions.

export const COORDINATION_CONTRACT_VERSION = "1.0.0";

export const PlanState = z.enum([
  "BLOCKED", // a hard barrier makes the activity infeasible
  "PROPOSED", // feasible interventions computed, user has not accepted them
  "AWAITING_APPROVAL", // accepted; external actions need explicit scoped approval
  "PENDING_CONFIRMATION", // approved actions dispatched; waiting for provider/participant evidence
  "READY", // every required dependency confirmed
  "NEEDS_REPLAN", // a dependency failed/cancelled; recovery proposal attached
  "COMPLETED", // user reported the outcome
  "CANCELLED",
]);
export type PlanState = z.infer<typeof PlanState>;

export const Contact = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  relation: z.string().trim().max(40).optional(),
  canDrive: z.boolean().default(false),
});
export type Contact = z.infer<typeof Contact>;

export const ActionKind = z.enum(["invite", "ride"]);
export type ActionKind = z.infer<typeof ActionKind>;

// Exactly what the user authorizes: who is contacted, for what, which profile fields are shared, for which slot.
export const ActionScope = z.object({
  kind: ActionKind,
  activityId: z.string(), // the activity this action is for; a confirmation never transfers to another activity
  recipientId: z.string(),
  sharedFields: z.array(z.string()),
  when: z.string(),
});
export type ActionScope = z.infer<typeof ActionScope>;

export const ActionRequest = z.object({
  id: z.string(),
  interventionId: z.string(),
  planVersion: z.number().int(),
  scope: ActionScope,
  description: z.string(),
  status: z.enum(["proposed", "approved", "dispatched", "failed", "revoked", "superseded"]),
  approvalId: z.string().optional(),
  idempotencyKey: z.string(),
  providerRequestId: z.string().optional(),
  dispatchError: z.boolean().optional(), // last dispatch attempt had an unknown outcome; retry with the same key
});
export type ActionRequest = z.infer<typeof ActionRequest>;

export const DependencyStatus = z.enum(["not_requested", "requested", "confirmed", "declined", "cancelled", "failed"]);
export type DependencyStatus = z.infer<typeof DependencyStatus>;

export const Dependency = z.object({
  id: z.string(),
  actionId: z.string(),
  kind: ActionKind,
  label: z.string(),
  status: DependencyStatus,
  lastSequence: z.number().int(), // highest provider sequence applied; lower/equal ones are stale
});
export type Dependency = z.infer<typeof Dependency>;

export const Intervention = z.object({
  id: z.string(),
  kind: z.enum(["ride", "invite", "user_step"]),
  rule: z.string(), // barrier rule it mitigates
  description: z.string(),
  actionId: z.string().optional(), // set when an external action is needed
});
export type Intervention = z.infer<typeof Intervention>;

export const Approval = z.object({
  id: z.string(),
  actionId: z.string(),
  scope: ActionScope,
  approvedBy: z.literal("user"),
  approvedAt: z.string(),
  expiresAt: z.string(),
  revoked: z.boolean(),
});
export type Approval = z.infer<typeof Approval>;

export const PreferenceField = z.enum(["prefersSmallGroups", "maxTravelMin", "budgetPerWeek"]);
export const PreferencePatch = z.object({
  id: z.string(),
  field: PreferenceField,
  from: z.union([z.boolean(), z.number()]),
  to: z.union([z.boolean(), z.number()]),
  evidence: z.string(),
  status: z.enum(["proposed", "applied", "rejected"]),
});
export type PreferencePatch = z.infer<typeof PreferencePatch>;

export const FeedbackSignal = z.enum(["enjoyed", "too_crowded", "too_far", "too_expensive"]);
export type FeedbackSignal = z.infer<typeof FeedbackSignal>;

export const EventOutcome = z.enum(["applied", "duplicate", "ignored", "rejected"]);
export const CoordinationEvent = z.object({
  seq: z.number().int(),
  at: z.string(),
  type: z.string(),
  actor: z.enum(["user", "agent", "provider", "demo"]),
  outcome: EventOutcome,
  reason: z.string().optional(),
  idempotencyKey: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type CoordinationEvent = z.infer<typeof CoordinationEvent>;

export const CoordinationPlan = z.object({
  id: z.string(),
  contractVersion: z.string(),
  version: z.number().int(), // bumps on every replan; actions from older versions are superseded
  state: PlanState,
  profile: Profile,
  profileVersion: z.number().int(),
  contacts: z.array(Contact),
  activityId: z.string(),
  activityName: z.string(),
  when: z.string(),
  blockers: z.array(Barrier),
  interventions: z.array(Intervention),
  actions: z.array(ActionRequest),
  dependencies: z.array(Dependency),
  approvals: z.array(Approval),
  alternatives: z.array(z.object({ activityId: z.string(), name: z.string(), when: z.string() })),
  preferencePatches: z.array(PreferencePatch),
  outcome: z.object({ attended: z.boolean(), source: z.literal("self_reported") }).optional(),
  dataSource: z.enum(["mock", "live"]), // provider evidence source; "mock" = simulated providers
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CoordinationPlan = z.infer<typeof CoordinationPlan>;

export const CreatePlanInput = z.object({
  profile: Profile,
  activityId: z.string().min(1),
  contacts: z
    .array(Contact)
    .max(10)
    .default([])
    .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, "Contact ids must be unique")
    .refine((cs) => cs.every((c) => c.id !== "paratransit"), 'Contact id "paratransit" is reserved'),
});
export type CreatePlanInput = z.input<typeof CreatePlanInput>;

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid ISO timestamp");
export const PlanCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("accept_proposal") }),
  z.object({ type: z.literal("approve"), actionId: z.string(), scope: ActionScope, expiresAt: iso }),
  z.object({ type: z.literal("revoke"), actionId: z.string() }),
  z.object({ type: z.literal("execute") }),
  z.object({ type: z.literal("choose_alternative"), activityId: z.string() }),
  z.object({ type: z.literal("complete"), attended: z.boolean() }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("feedback"), signals: z.array(FeedbackSignal).min(1) }),
  z.object({ type: z.literal("confirm_preference"), patchId: z.string() }),
  z.object({ type: z.literal("reject_preference"), patchId: z.string() }),
]);
export type PlanCommand = z.infer<typeof PlanCommand>;

export const ProviderEventType = z.enum(["invite.accepted", "invite.declined", "invite.cancelled", "ride.confirmed", "ride.declined", "ride.cancelled"]);
export const ProviderEvent = z.object({
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  requestId: z.string().min(1), // providerRequestId returned at dispatch
  sequence: z.number().int().min(1), // per-request, monotonically increasing at the provider
  type: ProviderEventType,
  actor: z.enum(["provider", "demo"]),
});
export type ProviderEvent = z.infer<typeof ProviderEvent>;

export const CommandResult = z.object({
  plan: CoordinationPlan,
  outcome: EventOutcome,
  reason: z.string().optional(),
  events: z.array(CoordinationEvent), // events appended by this call
});
export type CommandResult = z.infer<typeof CommandResult>;

// ─── Enrichment contract (additive; see docs/daybridge/ENRICHMENT_CONTRACT.md) ───
// Third-party data shown next to the deterministic plan. It never changes plan/blocked; every value says where it came from.

export const Provenance = z.object({
  source: z.enum(["live", "estimate", "mock"]),
  provider: z.string().min(1), // e.g. "google-places", "open-meteo", "uber"
  fetchedAt: z.iso.datetime({ offset: true }),
  verified: z.literal(false), // third-party claims are never verified by DayBridge
});
export type Provenance = z.infer<typeof Provenance>;

export const VenueInfo = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accessibility: z.object({ wheelchairEntrance: z.boolean().nullable().optional() }).optional(), // crowd-sourced: UI says "unconfirmed"
  provenance: Provenance,
});
export type VenueInfo = z.infer<typeof VenueInfo>;

// null = no forecast data. Never say "no rain" without a forecast for that date.
export const WeatherNote = z
  .object({
    date: z.iso.date(), // YYYY-MM-DD of the activity occurrence the forecast covers
    summary: z.string().min(1),
    precipitationChance: z.number().min(0).max(100).optional(), // percent
    outdoorConcern: z.boolean().optional(),
    provenance: Provenance,
  })
  .nullable();
export type WeatherNote = z.infer<typeof WeatherNote>;

export const RideshareOption = z.object({
  provider: z.enum(["uber", "lyft"]),
  deepLink: z.url({ protocol: /^https$/ }),
  fare: z
    .object({ low: z.number().min(0), high: z.number().min(0), currency: z.string().regex(/^[A-Z]{3}$/) })
    .refine((f) => f.low <= f.high, "fare.low must be <= fare.high")
    .optional(),
  pickupLabel: z.string().min(1), // must contain "(demo)" when it is the default demo pickup
  notBooked: z.literal(true), // a deep link opens the app; DayBridge never books
  provenance: Provenance,
});
export type RideshareOption = z.infer<typeof RideshareOption>;

export const EnrichmentMeta = z.object({
  enabled: z.boolean(), // DAYBRIDGE_ENRICH === "1"
  budgetMs: z.number().int().min(0).max(2500), // DECISIONS.md cap
  timedOut: z.boolean(), // true = budget hit, base plan returned
});
export type EnrichmentMeta = z.infer<typeof EnrichmentMeta>;
