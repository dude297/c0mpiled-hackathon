// Framework-free device store (SCREENS.md "DS"). React binding lives in store.tsx; tests in device-store.test.ts.
import type { AnalysisResult, Profile } from "@/lib/schema";
import {
  DEFAULT_ACTIVE, KEYS, NOT_STARTED, PERSONS, SESSION_PROFILE_KEY,
  friendlyAnalyzeError, parseActive, parsePlans, parseProfile, parseResult, parseWeek, personKeys, profileHash, readPlanResponse, reconcileWeek, toggleId,
  type DroppedOuting, type Mode, type PersonKey, type PlanMap, type PlanStatus,
} from "./helpers";

export type DeviceState = {
  /** false until the browser storage has been read (always false during SSR / first paint). */
  ready: boolean;
  /** false in a private window etc.: answers live in memory only ("This browser won't remember your answers."). */
  storageOk: boolean;
  person: PersonKey;
  mode: Mode;
  profile: Profile | null;
  result: AnalysisResult | null;
  /** activityIds the person added to their week. */
  week: string[];
  /** activityId → coordination planId (written by /coordinate). */
  plans: PlanMap;
  /** Outings that fell out of the week on the last re-plan (U2 heads-up). In memory only. */
  dropped: DroppedOuting[];
  analyzing: boolean;
  /** Friendly one-line error from the last analyze; the last result is kept. */
  error: string | null;
  /** People with saved answers on this device ("You" shows in the switcher only if "me" is here). */
  savedPeople: PersonKey[];
  /** By activityId; missing = Not started. Filled by refreshPlanStatus(). */
  planStatus: Record<string, PlanStatus>;
  /** "unavailable" = hosted server returned 503: hide status words, show one line. */
  liveStatus: "unknown" | "ok" | "unavailable";
};

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
export type StoreDeps = {
  local: KV | null;
  session: KV | null;
  fetch: typeof fetch;
  demoProfiles: Partial<Record<PersonKey, Profile>>;
};

export const INITIAL_STATE: DeviceState = {
  ready: false, storageOk: true, person: DEFAULT_ACTIVE.person, mode: DEFAULT_ACTIVE.mode,
  profile: null, result: null, week: [], plans: {}, dropped: [], analyzing: false, error: null,
  savedPeople: [], planStatus: {}, liveStatus: "unknown",
};

/** Wraps a Storage with try/catch; falls back to an in-memory map when it is missing or throws. */
function safeKV(kv: KV | null): { kv: KV; ok: boolean } {
  const mem = new Map<string, string>();
  const memKV: KV = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  if (!kv) return { kv: memKV, ok: false };
  try {
    kv.setItem("daybridge:v1:probe", "1");
    kv.removeItem("daybridge:v1:probe");
  } catch {
    return { kv: memKV, ok: false };
  }
  return {
    ok: true,
    kv: {
      getItem: (k) => { try { return kv.getItem(k); } catch { return memKV.getItem(k); } },
      setItem: (k, v) => { try { kv.setItem(k, v); } catch { memKV.setItem(k, v); } },
      removeItem: (k) => { try { kv.removeItem(k); } catch {} memKV.removeItem(k); },
    },
  };
}

export function createDeviceStore(deps: StoreDeps) {
  let state = INITIAL_STATE;
  const listeners = new Set<() => void>();
  let local: KV = safeKV(null).kv;
  let session: KV = safeKV(null).kv;
  let reqId = 0; // stale-response guard for analyze
  let statusReq = 0; // stale-response guard for plan status

  const set = (patch: Partial<DeviceState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const write = (k: string, v: unknown) => local.setItem(k, JSON.stringify(v));
  const savedPeople = () => PERSONS.filter((p) => parseProfile(local.getItem(KEYS.profile(p))) !== null);
  const writeActive = () => write(KEYS.active, { person: state.person, mode: state.mode });

  /** Reads one person's keys; seeds a demo person from DEMO_PROFILES. */
  function readPerson(person: PersonKey) {
    let profile = parseProfile(local.getItem(KEYS.profile(person)));
    const demo = deps.demoProfiles[person];
    if (!profile && demo) {
      profile = demo;
      write(KEYS.profile(person), demo);
    }
    const cached = parseResult(local.getItem(KEYS.result(person)));
    const fresh = profile && cached && cached.profileHash === profileHash(profile) ? cached.result : null;
    const stored = parseWeek(local.getItem(KEYS.week(person)));
    const result = fresh ?? cached?.result ?? null;
    const week = stored ?? result?.plan.map((i) => i.activityId) ?? [];
    return { profile, result, week, plans: parsePlans(local.getItem(KEYS.plans(person))), needsAnalyze: !!profile && !fresh };
  }

  function load(person: PersonKey, mode: Mode) {
    const p = readPerson(person);
    set({
      person, mode, profile: p.profile, result: p.result, week: p.week, plans: p.plans,
      dropped: [], error: null, analyzing: false, planStatus: {}, liveStatus: "unknown", savedPeople: savedPeople(),
    });
    writeActive();
    if (p.needsAnalyze) void analyze();
  }

  /** Golden-path handoff: "/" writes sessionStorage "daybridge:profile" on run. Returns whose profile it is. */
  function adoptSessionProfile(): PersonKey | null {
    const sp = parseProfile(session.getItem(SESSION_PROFILE_KEY));
    if (!sp) return null;
    const h = profileHash(sp);
    const owner = PERSONS.find((p) => {
      const stored = parseProfile(local.getItem(KEYS.profile(p)));
      const ref = stored ?? deps.demoProfiles[p];
      return ref ? profileHash(ref) === h : false;
    });
    if (owner) return owner;
    if (parseProfile(local.getItem(KEYS.profile("me")))) return null; // "me" already has answers: keep them
    write(KEYS.profile("me"), sp);
    return "me";
  }

  function hydrate() {
    if (state.ready) return;
    const l = safeKV(deps.local);
    local = l.kv;
    session = safeKV(deps.session).kv;
    const storedActive = parseActive(local.getItem(KEYS.active));
    const adopted = adoptSessionProfile();
    const active = storedActive ?? { ...DEFAULT_ACTIVE, person: adopted ?? DEFAULT_ACTIVE.person };
    set({ ready: true, storageOk: l.ok });
    load(active.person, active.mode);
  }

  /** POST /api/analyze for the active person. Saves the profile first (U1 finish / U6 Save). Never throws. */
  async function analyze(next?: Profile): Promise<AnalysisResult | null> {
    const profile = next ?? state.profile;
    if (!profile) return null;
    const person = state.person;
    const id = ++reqId;
    write(KEYS.profile(person), profile);
    try {
      session.setItem(SESSION_PROFILE_KEY, JSON.stringify(profile)); // X1 reads this
    } catch {}
    set({ profile, analyzing: true, error: null, savedPeople: savedPeople() });
    let httpStatus: number | null = null;
    try {
      const res = await deps.fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      httpStatus = res.status;
      const data = (await res.json().catch(() => null)) as AnalysisResult | null;
      if (id !== reqId) return null; // stale: newer run, person switch or reset
      if (!res.ok || !data || !Array.isArray(data.plan)) throw new Error("bad response");
      const prevWeek = parseWeek(local.getItem(KEYS.week(person)));
      const { week, dropped } = reconcileWeek(prevWeek, state.result, data);
      write(KEYS.result(person), { result: data, profileHash: profileHash(profile) });
      write(KEYS.week(person), week);
      set({ result: data, week, dropped, analyzing: false, error: null });
      return data;
    } catch {
      if (id !== reqId) return null;
      set({ analyzing: false, error: friendlyAnalyzeError(httpStatus) });
      return null;
    }
  }

  function selectPerson(person: PersonKey) {
    reqId++;
    statusReq++;
    load(person, state.mode);
  }

  function setMode(mode: Mode) {
    if (mode === state.mode) return;
    set({ mode });
    writeActive();
  }

  /** Route-driven mode: /care is caregiver, /home and /matches are user-only. Others keep the current mode. */
  function syncRoute(pathname: string) {
    if (pathname === "/care" || pathname.startsWith("/care/")) setMode("caregiver");
    else if (pathname === "/home" || pathname === "/matches") setMode("user");
  }

  function toggleWeek(activityId: string) {
    const week = toggleId(state.week, activityId);
    write(KEYS.week(state.person), week);
    set({ week });
  }

  /** Start over: clears the active person's keys only; other people are kept. */
  function reset() {
    reqId++;
    statusReq++;
    personKeys(state.person).forEach((k) => local.removeItem(k));
    try {
      session.removeItem(SESSION_PROFILE_KEY);
    } catch {}
    set({ profile: null, result: null, week: [], plans: {}, dropped: [], error: null, analyzing: false, planStatus: {}, liveStatus: "unknown", savedPeople: savedPeople() });
  }

  /** Re-read week/plans written elsewhere (another tab, /coordinate). Never calls the API. */
  function reload() {
    if (!state.ready) return;
    const p = readPerson(state.person);
    set({ week: p.week, plans: p.plans, savedPeople: savedPeople() });
  }

  /** GET /api/coordination/plans/:id for every saved plan id. 404 → drop the id (Not started). 503 → unavailable. */
  async function refreshPlanStatus(): Promise<void> {
    if (!state.ready) return;
    const id = ++statusReq;
    const person = state.person;
    const entries = Object.entries(state.plans);
    const outcomes = await Promise.all(
      entries.map(async ([activityId, planId]) => {
        try {
          const res = await deps.fetch(`/api/coordination/plans/${encodeURIComponent(planId)}`);
          return [activityId, readPlanResponse(planId, res.status, await res.json().catch(() => null))] as const;
        } catch {
          return [activityId, { kind: "error" } as const] as const;
        }
      }),
    );
    if (id !== statusReq || person !== state.person) return;
    const planStatus: Record<string, PlanStatus> = {};
    const plans = { ...parsePlans(local.getItem(KEYS.plans(person))) };
    let unavailable = false;
    for (const [activityId, o] of outcomes) {
      if (o.kind === "ok") planStatus[activityId] = o.status;
      else if (o.kind === "gone") {
        delete plans[activityId];
        planStatus[activityId] = NOT_STARTED;
      } else if (o.kind === "unavailable") unavailable = true;
      else if (state.planStatus[activityId]) planStatus[activityId] = state.planStatus[activityId]; // transient error: keep last known
    }
    write(KEYS.plans(person), plans);
    set({ plans, planStatus, liveStatus: unavailable ? "unavailable" : "ok" });
  }

  return {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    hydrate, analyze, selectPerson, setMode, syncRoute, toggleWeek, reset, reload, refreshPlanStatus,
  };
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;
