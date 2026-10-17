import { describe, expect, it, vi } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import type { AnalysisResult, PlanItem, Profile } from "@/lib/schema";
import { createDeviceStore, type KV } from "./device-store";
import { KEYS, SESSION_PROFILE_KEY, profileHash } from "./helpers";

const memKV = (init: Record<string, string> = {}): KV & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const item = (activityId: string): PlanItem => ({ activityId, name: activityId, when: "Wed afternoon", travel: "Bus", costPerWeek: 0, score: 1, barriers: [] });
const result = (ids: string[]): AnalysisResult => ({ summary: "s", items: [], plan: ids.map(item), blocked: [], evidence: [], explanation: "e", dataSource: "mock" });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const me: Profile = { ...DEMO_PROFILES.harold, name: "Sam" };
const demos = { margaret: DEMO_PROFILES.margaret, harold: DEMO_PROFILES.harold };

function setup(local = memKV(), session = memKV(), fetchImpl = vi.fn(async () => json(200, result(["a", "b"])))) {
  const store = createDeviceStore({ local, session, fetch: fetchImpl as unknown as typeof fetch, demoProfiles: demos });
  return { store, local, session, fetchImpl };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("hydrate", () => {
  it("empty device: active = me, no profile, no API call", () => {
    const { store, fetchImpl } = setup();
    store.hydrate();
    expect(store.getState()).toMatchObject({ ready: true, person: "me", profile: null, storageOk: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("adopts the profile written by / into sessionStorage as 'me' and analyzes once", async () => {
    const session = memKV({ [SESSION_PROFILE_KEY]: JSON.stringify(me) });
    const { store, local, fetchImpl } = setup(memKV(), session);
    store.hydrate();
    await flush();
    expect(store.getState()).toMatchObject({ person: "me", profile: me, week: ["a", "b"] });
    expect(JSON.parse(local.getItem(KEYS.profile("me"))!)).toEqual(me);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a demo profile in sessionStorage selects that sample person instead of becoming 'me'", () => {
    const session = memKV({ [SESSION_PROFILE_KEY]: JSON.stringify(DEMO_PROFILES.margaret) });
    const { store, local } = setup(memKV(), session);
    store.hydrate();
    expect(store.getState().person).toBe("margaret");
    expect(local.getItem(KEYS.profile("me"))).toBeNull();
  });

  it("cached result with a matching hash renders at once, no API call", () => {
    const local = memKV({
      [KEYS.active]: JSON.stringify({ person: "me", mode: "user" }),
      [KEYS.profile("me")]: JSON.stringify(me),
      [KEYS.result("me")]: JSON.stringify({ result: result(["x"]), profileHash: profileHash(me) }),
      [KEYS.week("me")]: JSON.stringify([]),
    });
    const { store, fetchImpl } = setup(local);
    store.hydrate();
    expect(store.getState()).toMatchObject({ result: result(["x"]), week: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("storage that throws falls back to memory and says so", () => {
    const broken: KV = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    const { store } = setup(broken as never);
    store.hydrate();
    expect(store.getState()).toMatchObject({ ready: true, storageOk: false });
    store.toggleWeek("a");
    expect(store.getState().week).toEqual(["a"]);
  });
});

describe("analyze", () => {
  it("writes the golden-path handoff and keeps only still-planned ids on re-plan", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, result(["a", "b"]))).mockResolvedValueOnce(json(200, result(["b", "c"])));
    const { store, session } = setup(memKV(), memKV(), fetchImpl);
    store.hydrate();
    await store.analyze(me);
    expect(JSON.parse(session.getItem(SESSION_PROFILE_KEY)!)).toEqual(me);
    expect(store.getState().week).toEqual(["a", "b"]);
    await store.analyze({ ...me, maxTravelMin: 60 });
    expect(store.getState().week).toEqual(["b"]);
    expect(store.getState().dropped.map((d) => d.activityId)).toEqual(["a"]);
  });

  it("friendly error, last result kept", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, result(["a"]))).mockResolvedValueOnce(json(500, { error: "boom" }));
    const { store } = setup(memKV(), memKV(), fetchImpl);
    store.hydrate();
    await store.analyze(me);
    await store.analyze(me);
    expect(store.getState()).toMatchObject({ analyzing: false });
    expect(store.getState().result?.plan[0].activityId).toBe("a"); // still-fitting extras are appended after the top picks
    expect(store.getState().error).toMatch(/try again/);
    expect(store.getState().error).not.toMatch(/boom|500/);
  });

  it("ignores a stale response after switching person", async () => {
    let release!: (r: Response) => void;
    const fetchImpl = vi.fn().mockImplementationOnce(() => new Promise<Response>((r) => (release = r))).mockResolvedValue(json(200, result(["h"])));
    const { store, local } = setup(memKV(), memKV(), fetchImpl);
    store.hydrate();
    const pending = store.analyze(me);
    store.selectPerson("harold");
    release(json(200, result(["stale"])));
    expect(await pending).toBeNull();
    await flush();
    expect(store.getState()).toMatchObject({ person: "harold", week: ["h"] });
    expect(local.getItem(KEYS.result("me"))).toBeNull();
  });
});

describe("people and mode", () => {
  it("selecting a sample seeds its profile and analyzes", async () => {
    const { store, fetchImpl } = setup();
    store.hydrate();
    store.selectPerson("margaret");
    await flush();
    expect(store.getState()).toMatchObject({ person: "margaret", profile: DEMO_PROFILES.margaret });
    expect(store.getState().savedPeople).toContain("margaret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("route drives caregiver mode and it is persisted", () => {
    const { store, local } = setup();
    store.hydrate();
    store.syncRoute("/care");
    expect(store.getState().mode).toBe("caregiver");
    store.syncRoute("/calendar");
    expect(store.getState().mode).toBe("caregiver");
    store.syncRoute("/home");
    expect(JSON.parse(local.getItem(KEYS.active)!)).toEqual({ person: "me", mode: "user" });
  });

  it("reset clears only the active person", async () => {
    const { store, local, session } = setup();
    store.hydrate();
    store.selectPerson("harold");
    await flush();
    store.selectPerson("margaret");
    await flush();
    store.reset();
    expect(store.getState()).toMatchObject({ profile: null, result: null, week: [] });
    expect(local.getItem(KEYS.profile("margaret"))).toBeNull();
    expect(local.getItem(KEYS.profile("harold"))).not.toBeNull();
    expect(session.getItem(SESSION_PROFILE_KEY)).toBeNull();
  });
});

describe("refreshPlanStatus", () => {
  it("404 drops the id (Not started), 200 reads the state, 503 marks live status unavailable", async () => {
    const local = memKV({
      [KEYS.active]: JSON.stringify({ person: "me", mode: "user" }),
      [KEYS.profile("me")]: JSON.stringify(me),
      [KEYS.result("me")]: JSON.stringify({ result: result(["a", "b"]), profileHash: profileHash(me) }),
      [KEYS.plans("me")]: JSON.stringify({ a: "pa", b: "pb" }),
    });
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/pa") ? json(200, { state: "READY" }) : json(404, { error: "Plan not found" })));
    const { store } = setup(local, memKV(), fetchImpl as never);
    store.hydrate();
    await store.refreshPlanStatus();
    expect(store.getState().planStatus.a?.state).toBe("READY");
    expect(store.getState().planStatus.b?.state).toBeNull();
    expect(store.getState().plans).toEqual({ a: "pa" });
    expect(JSON.parse(local.getItem(KEYS.plans("me"))!)).toEqual({ a: "pa" });

    fetchImpl.mockImplementation(async () => json(503, { error: "off" }));
    await store.refreshPlanStatus();
    expect(store.getState().liveStatus).toBe("unavailable");
  });
});
