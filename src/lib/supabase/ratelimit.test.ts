import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ configured: false, rpc: vi.fn() }));
vi.mock("./server", () => ({ supabaseConfigured: () => m.configured, adminClient: () => ({ rpc: m.rpc }) }));
import { rateLimit, retryAfterSec } from "./ratelimit";

beforeEach(() => {
  m.configured = false;
  m.rpc.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("rateLimit (memory)", () => {
  it("allows exactly `limit` hits per window, isolates keys, resets on rollover", async () => {
    vi.useFakeTimers({ now: 1_000_000 * 60_000 }); // window-aligned
    const hits = async (k: string, n: number) => {
      const r: boolean[] = [];
      for (let i = 0; i < n; i++) r.push(await rateLimit(k, 3, 60));
      return r;
    };
    expect(await hits("a", 5)).toEqual([true, true, true, false, false]);
    expect(await hits("b", 1)).toEqual([true]); // other key unaffected
    vi.advanceTimersByTime(60_000);
    expect(await hits("a", 1)).toEqual([true]); // new window
  });
  it("retryAfterSec counts down to the window end", () => {
    expect(retryAfterSec(60, 60_000 * 10 + 15_000)).toBe(45);
    expect(retryAfterSec(3600, 0)).toBe(3600);
  });
});

describe("rateLimit (supabase RPC, mocked)", () => {
  beforeEach(() => (m.configured = true));
  it("passes args and returns the RPC verdict", async () => {
    m.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await rateLimit("k", 5, 60)).toBe(true);
    expect(await rateLimit("k", 5, 60)).toBe(false);
    expect(m.rpc).toHaveBeenCalledWith("rate_limit_hit", { p_key: "k", p_limit: 5, p_window_sec: 60 });
  });
  it("fails closed on RPC error or throw, without leaking details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: "db down" } }).mockRejectedValueOnce(new Error("network"));
    expect(await rateLimit("k", 5, 60)).toBe(false);
    expect(await rateLimit("k", 5, 60)).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
