import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/integrations/events", () => ({ discoverPublicEvents: vi.fn() }));
import { discoverPublicEvents } from "@/lib/integrations/events";
import { GET } from "./route";
beforeEach(() => vi.stubEnv("DAYBRIDGE_EVENTS", "1"));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetAllMocks(); });
it("is disabled by default: no stream and no outbound request", async () => {
  vi.stubEnv("DAYBRIDGE_EVENTS", "");
  const response = await GET(new Request("http://test/api/integrations/events/live"));
  expect(response.status).toBe(404);
  expect(discoverPublicEvents).not.toHaveBeenCalled();
});
it("closes the stream after five minutes", async () => {
  vi.useFakeTimers();
  vi.mocked(discoverPublicEvents).mockResolvedValue({ status: "live", events: [], sourceUrl: "https://events.berkeley.edu/", checkedAt: "2026-10-17T21:00:00Z" } as never);
  const response = await GET(new Request("http://test/api/integrations/events/live"));
  const reader = response.body!.getReader();
  await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
  let done = false; let text = "";
  for (let i = 0; i < 50 && !done; i++) { const r = await reader.read(); done = r.done; if (r.value) text += new TextDecoder().decode(r.value); }
  expect(done).toBe(true);
  expect(text).toContain("event: end");
});
it("sends an initial snapshot, updates every minute, and stops on disconnect", async () => {
  vi.useFakeTimers();
  const result = { status: "live" as const, events: [], sourceUrl: "https://events.berkeley.edu/", checkedAt: "2026-10-17T21:00:00Z" };
  vi.mocked(discoverPublicEvents).mockResolvedValue(result);
  const abort = new AbortController();
  const response = await GET(new Request("http://test/api/integrations/events/live", { signal: abort.signal }));
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader(); const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toContain("retry: 300000");
  expect(decoder.decode((await reader.read()).value)).toContain('"checkedAt":"2026-10-17T21:00:00Z"');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(decoder.decode((await reader.read()).value)).toContain("event: events");
  expect(discoverPublicEvents).toHaveBeenCalledTimes(2);
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(discoverPublicEvents).toHaveBeenCalledTimes(2);
});
it("stops polling when the reader cancels", async () => {
  vi.useFakeTimers();
  vi.mocked(discoverPublicEvents).mockResolvedValue({ status: "unavailable", events: [], sourceUrl: "https://events.berkeley.edu/", checkedAt: null });
  const response = await GET(new Request("http://test/live"));
  const reader = response.body!.getReader();
  await reader.cancel();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(discoverPublicEvents).toHaveBeenCalledTimes(1);
});
