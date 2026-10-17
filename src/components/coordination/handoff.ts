import { z } from "zod";
import { Profile, type AnalysisResult } from "@/lib/schema";

export const PROFILE_SESSION_KEY = "daybridge:profile";

const Handoff = z.object({
  profile: Profile,
  analyzedAt: z.iso.datetime(),
  resultActivityIds: z.array(z.string()),
});

export function analysisHandoff(profile: Profile, result: AnalysisResult, analyzedAt: string) {
  return { profile, analyzedAt, resultActivityIds: result.plan.map((item) => item.activityId) };
}

// Legacy plain profiles predate resultActivityIds. New records must prove membership.
export function coordinationProfile(raw: string | null, activityId: string | null): Profile | null {
  if (!raw || !activityId) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "profile" in value) {
      const parsed = Handoff.safeParse(value);
      return parsed.success && parsed.data.resultActivityIds.includes(activityId) ? parsed.data.profile : null;
    }
    const legacy = Profile.safeParse(value);
    return legacy.success ? legacy.data : null;
  } catch {
    return null;
  }
}
