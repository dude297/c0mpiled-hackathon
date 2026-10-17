import { afterEach, describe, expect, it, vi } from "vitest";

const auth = {
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  refreshSession: vi.fn(),
};
const createClient = vi.fn(() => ({ auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

// browser.ts reads env at module load, so stub env then import fresh.
async function load(cloud: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", cloud ? "https://example.supabase.co" : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", cloud ? "sb_publishable_test" : "");
  return import("./browser");
}

const authHeader = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers).get("Authorization");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("authFetch", () => {
  it("is plain fetch when cloud env is unset (no supabase calls, no Authorization)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { authFetch, cloudEnabled } = await load(false);
    expect(cloudEnabled()).toBe(false);
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
    const res = await authFetch("/api/x", init);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(["/api/x", init]);
    expect(authHeader(fetchMock.mock.calls[0])).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("adds Bearer, and on 401 refreshes once and retries once", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "old" } } });
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "new" } } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { authFetch } = await load(true);
    const res = await authFetch("/api/x", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(fetchMock.mock.calls[0])).toBe("Bearer old");
    expect(authHeader(fetchMock.mock.calls[1])).toBe("Bearer new");
    expect(fetchMock.mock.calls[1][1].body).toBe("{}");
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("does not loop: a second 401 is returned as-is", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "old" } } });
    auth.refreshSession.mockResolvedValue({ data: { session: { access_token: "new" } } });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { authFetch } = await load(true);
    const res = await authFetch("/api/x");
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("signs in anonymously when there is no session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInAnonymously.mockResolvedValue({ data: { session: { access_token: "guest" } }, error: null });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { authFetch } = await load(true);
    await authFetch("/api/x");
    expect(authHeader(fetchMock.mock.calls[0])).toBe("Bearer guest");
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});
