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
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;
