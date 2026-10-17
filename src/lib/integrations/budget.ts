export const ENRICHMENT_BUDGET_MS = 1_000;

// The race bounds response latency even if a provider ignores cancellation.
// The shared signal also aborts real fetches, including response-body reads.
export async function withEnrichmentBudget<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
      controller.abort();
    }, ENRICHMENT_BUDGET_MS);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), deadline]).catch(() => null);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
