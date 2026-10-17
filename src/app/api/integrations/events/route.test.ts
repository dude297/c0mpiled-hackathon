import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/integrations/events", () => ({ discoverPublicEvents: vi.fn() }));
import { discoverPublicEvents } from "@/lib/integrations/events";
import { GET } from "./route";
afterEach(() => vi.resetAllMocks());
it("returns the discovery contract without accepting a personal profile", async () => {
  const result = { status: "live" as const, events: [], sourceUrl: "https://events.berkeley.edu/", checkedAt: "2026-10-17T20:00:00.000Z" };
  vi.mocked(discoverPublicEvents).mockResolvedValue(result);
  const response = await GET();
  expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
