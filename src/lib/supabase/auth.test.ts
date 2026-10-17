import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ adminClient: () => ({ auth: { getUser } }), supabaseConfigured: () => true }));

import { getUserId } from "./auth";

const req = (authorization?: string) => new Request("http://x/api", { headers: authorization ? { authorization } : {} });

describe("getUserId", () => {
  beforeEach(() => { getUser.mockReset(); });

  it("returns null without an Authorization header", async () => {
    expect(await getUserId(req())).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects non-Bearer schemes, empty and oversized tokens without calling Supabase", async () => {
    for (const h of ["Basic abc", "bearer", "Bearer ", "Token a.b.c", "Bearer a b", `Bearer ${"a".repeat(9000)}`]) {
      expect(await getUserId(req(h))).toBeNull();
    }
    expect(getUser).not.toHaveBeenCalled();
  });

  it("returns null when Supabase rejects the token", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    expect(await getUserId(req("Bearer a.b.c"))).toBeNull();
  });

  it("returns the verified user id for a valid token", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    expect(await getUserId(req("Bearer a.b.c"))).toBe("user-1");
    expect(getUser).toHaveBeenCalledWith("a.b.c");
  });

  it("fails closed when verification throws", async () => {
    getUser.mockRejectedValue(new Error("network down"));
    expect(await getUserId(req("Bearer a.b.c"))).toBeNull();
  });
});
