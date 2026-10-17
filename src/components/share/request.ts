import type { AnalysisResult } from "@/lib/schema";

// Body for POST /api/plans. Never includes the profile (the API rejects it with 400).
export function buildShareRequest(result: AnalysisResult, firstNameOnly: boolean) {
  return { result, consent: true as const, firstNameOnly };
}

export type ShareCreated = { id: string; url: string; revokeToken: string; expiresAt: string; storage?: string };

export type Outcome = { kind: "ok" | "unavailable" | "error"; message: string };

// POST /api/plans status → what the UI says. 201 is success; everything else is shown, never faked.
export function describeShareStatus(status: number): Outcome {
  if (status === 201) return { kind: "ok", message: "Link created." };
  if (status === 503) return { kind: "unavailable", message: "Sharing isn't available on this deployment yet." };
  if (status === 413) return { kind: "error", message: "This plan is too large to share." };
  if (status === 400) return { kind: "error", message: "The plan couldn't be shared. Please re-run the plan and try again." };
  return { kind: "error", message: "Something went wrong creating the link. Please try again." };
}

// DELETE /api/plans/:id status → what the UI says.
export function describeStopStatus(status: number): Outcome {
  if (status === 204) return { kind: "ok", message: "Link turned off." };
  if (status === 404) return { kind: "ok", message: "Link already expired or turned off." };
  if (status === 503) return { kind: "unavailable", message: "Sharing isn't available on this deployment yet." };
  return { kind: "error", message: "Couldn't turn the link off. Please try again." };
}

export const NETWORK_ERROR: Outcome = { kind: "error", message: "Can't reach the server. Check your connection and try again." };

// ponytail: the API has no `storage` field today and the only store is in-memory, so absent means memory.
export const isMemoryStore = (c: ShareCreated) => (c.storage ?? "memory") === "memory";
