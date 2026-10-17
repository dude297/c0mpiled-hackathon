import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import { runScenario } from "@/domain/engine";
import { _resetShareStore, getShare } from "@/lib/share/share";
import { DELETE } from "./[id]/route";
import { POST } from "./route";

const result = { ...runScenario({ profile: DEMO_PROFILES.margaret }), explanation: "Margaret uses a walker", dataSource: "mock" as const };
const post = (body: unknown) =>
  POST(new Request("http://test/api/plans", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const del = (id: string, token?: string) =>
  DELETE(new Request(`http://test/api/plans/${id}`, { method: "DELETE", headers: token ? { authorization: `Bearer ${token}` } : {} }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => _resetShareStore());
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/plans", () => {
  it("201 with id, url, revokeToken, expiresAt; stored snapshot is redacted", async () => {
    const res = await post({ result, consent: true, firstNameOnly: true, expiresInDays: 3 });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.url).toBe(`/plan/${data.id}`);
    expect(typeof data.revokeToken).toBe("string");
    expect(Date.parse(data.expiresAt)).toBeGreaterThan(Date.now());
    const snap = getShare(data.id)!;
    expect(snap.displayName).toBe("Margaret");
    expect(JSON.stringify(snap)).not.toMatch(/walker/i);
  });

  it("400 for the current UI payload {profile, result} (no consent; profile is never accepted)", async () => {
    const res = await post({ profile: DEMO_PROFILES.margaret, result });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it.each([{ result, consent: true, profile: DEMO_PROFILES.margaret }, { result }, { result, consent: "yes" }, "not json", null])(
    "400 for %j",
    async (body) => {
      expect((await post(body)).status).toBe(400);
    },
  );

  it("413 over 200k chars", async () => {
    expect((await post({ result: { ...result, explanation: "x".repeat(200_001) }, consent: true })).status).toBe(413);
  });

  it("503 in production unless SHARE_STORE=memory", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHARE_STORE", "");
    expect((await post({ result, consent: true })).status).toBe(503);
    expect((await del("x".repeat(22), "t")).status).toBe(503);
    vi.stubEnv("SHARE_STORE", "memory");
    expect((await post({ result, consent: true })).status).toBe(201);
  });
});

describe("DELETE /api/plans/:id", () => {
  it("204 with the revoke token, then 404; wrong or missing token is 404", async () => {
    const { id, revokeToken } = await (await post({ result, consent: true })).json();
    expect((await del(id)).status).toBe(404);
    expect((await del(id, "wrong")).status).toBe(404);
    expect((await del(id, revokeToken)).status).toBe(204);
    expect(getShare(id)).toBeNull();
    expect((await del(id, revokeToken)).status).toBe(404);
  });
});
