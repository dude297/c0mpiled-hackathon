// Injectable provider boundary (spec §9.1). A "requested" result is never a confirmation:
// confirmation only arrives later as a separate ProviderEvent.

export type DispatchInput = { planId: string; actionId: string; recipientId: string; approvalId: string; idempotencyKey: string; sharedFields: string[]; when: string };
export type DispatchResult = { requestId: string; status: "requested" | "failed"; reason?: string };

export interface ProviderPort {
  readonly dataSource: "mock" | "live";
  sendApprovedInvite(input: DispatchInput): Promise<DispatchResult>;
  requestApprovedRide(input: DispatchInput): Promise<DispatchResult>;
}

// Offline mock: records calls, sends nothing, and is idempotent by key like a well-behaved real provider.
export function createMockProvider(opts: { fail?: (input: DispatchInput) => boolean } = {}) {
  const calls: (DispatchInput & { kind: "invite" | "ride" })[] = [];
  const byKey = new Map<string, DispatchResult>();
  const dispatch = async (kind: "invite" | "ride", input: DispatchInput): Promise<DispatchResult> => {
    const prior = byKey.get(input.idempotencyKey);
    if (prior) return prior;
    calls.push({ ...input, kind });
    const result: DispatchResult = opts.fail?.(input)
      ? { requestId: `mock-${kind}-${input.idempotencyKey}`, status: "failed", reason: "Simulated provider failure" }
      : { requestId: `mock-${kind}-${input.idempotencyKey}`, status: "requested" };
    byKey.set(input.idempotencyKey, result);
    return result;
  };
  const provider: ProviderPort & { calls: typeof calls } = {
    dataSource: "mock",
    calls,
    sendApprovedInvite: (i) => dispatch("invite", i),
    requestApprovedRide: (i) => dispatch("ride", i),
  };
  return provider;
}
