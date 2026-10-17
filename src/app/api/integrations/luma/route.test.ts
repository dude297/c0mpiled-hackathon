import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/server", () => ({ connection: async () => {} }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("exposes a disabled discovery envelope without touching the network", async () => {
  vi.stubEnv("DAYBRIDGE_LUMA", "");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const response = await GET();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "disabled", events: [], sourceUrl: "https://luma.com/sf" });
  expect(fetch).not.toHaveBeenCalled();
});
