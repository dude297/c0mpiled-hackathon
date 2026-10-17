import { afterEach, expect, it, vi } from "vitest";
import { ENRICHMENT_BUDGET_MS, withEnrichmentBudget } from "./budget";
import { enrichResult } from "./places";
import { rideshareFor } from "./rideshare";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("returns promptly and clears the timer when enrichment is fast", async () => {
  vi.useFakeTimers();
  expect(await withEnrichmentBudget(async () => "done")).toBe("done");
  expect(vi.getTimerCount()).toBe(0);
});
it("returns the fallback after one second even when a provider ignores abort", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const result = withEnrichmentBudget((s) => { signal = s; return new Promise(() => {}); });
  await vi.advanceTimersByTimeAsync(ENRICHMENT_BUDGET_MS);
  expect(await result).toBeNull(); expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("fails soft and cleans up on provider rejection", async () => {
  vi.useFakeTimers();
  expect(await withEnrichmentBudget(async () => { throw new Error("offline"); })).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
const item = { activityId: "garden", name: "Garden Walk", when: "Sat morning", travel: "bus", costPerWeek: 0, score: 1, barriers: [] };
it("aborts both Places and weather fetches and does not start fares afterwards", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test"); vi.stubEnv("DAYBRIDGE_VENUE_PLACE_IDS", '{"garden":"reviewed"}');
  const signals: AbortSignal[] = [];
  const fetch = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_, reject) => {
    const signal = options.signal!; signals.push(signal);
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })); vi.stubGlobal("fetch", fetch);
  const result = withEnrichmentBudget((signal) => enrichResult({ plan: [item], blocked: [], evidence: [] }, signal));
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBeNull(); expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("also aborts an in-flight Uber fare request", async () => {
  vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.stubEnv("UBER_API_TOKEN", "test");
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_, reject) => {
    signal = options.signal;
    signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })));
  const result = withEnrichmentBudget((s) => rideshareFor(item, { lat: 37.87, lon: -122.26 }, "Garden", s));
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBeNull(); expect(signal?.aborted).toBe(true);
});
