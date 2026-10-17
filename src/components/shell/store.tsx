"use client";

// React binding for the device store (SCREENS.md "DS"). Every (app) route reads data through these hooks.
import { Suspense, createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DEMO_PROFILES } from "@/domain/activities";
import { createDeviceStore, INITIAL_STATE, type DeviceState, type DeviceStore } from "./device-store";
import { NOT_STARTED, planStatusView, type PlanStatus, type StatusView } from "./helpers";

export type { DeviceState, DeviceStore } from "./device-store";
export type { Active, DroppedOuting, Mode, PersonKey, PlanMap, PlanStatus, StatusIcon, StatusView, StoredResult } from "./helpers";
export { coordinateHref, planStatusView } from "./helpers";

const Ctx = createContext<DeviceStore | null>(null);

function browserStorage(kind: "localStorage" | "sessionStorage") {
  try {
    return window[kind];
  } catch {
    return null; // access itself can throw when site data is blocked
  }
}

export function DeviceStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    createDeviceStore({
      local: typeof window === "undefined" ? null : browserStorage("localStorage"),
      session: typeof window === "undefined" ? null : browserStorage("sessionStorage"),
      fetch: (...args) => fetch(...args),
      demoProfiles: { margaret: DEMO_PROFILES.margaret, harold: DEMO_PROFILES.harold },
    }),
  );
  useEffect(() => {
    store.hydrate();
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("daybridge:")) store.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [store]);

  return (
    <Ctx.Provider value={store}>
      {/* URL data must sit inside Suspense (cacheComponents): the rest of the page still prerenders. */}
      <Suspense fallback={null}>
        <RouteMode store={store} />
      </Suspense>
      {children}
    </Ctx.Provider>
  );
}

/** /care → caregiver mode, /home and /matches → user mode (see DeviceStore.syncRoute). */
function RouteMode({ store }: { store: DeviceStore }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) store.syncRoute(pathname);
  }, [store, pathname]);
  return null;
}

function useStore(): DeviceStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("useDevice* hooks must be used inside <DeviceStoreProvider> (src/app/(app)/layout.tsx)");
  return store;
}

/** Whole state snapshot + actions. `state.ready` is false until browser storage is read: render nothing data-dependent before that. */
export function useDeviceStore(): DeviceState & Omit<DeviceStore, "getState" | "subscribe" | "hydrate"> {
  const store = useStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, () => INITIAL_STATE);
  return {
    ...state,
    analyze: store.analyze, selectPerson: store.selectPerson, setMode: store.setMode, syncRoute: store.syncRoute,
    toggleWeek: store.toggleWeek, reset: store.reset, reload: store.reload, refreshPlanStatus: store.refreshPlanStatus,
  };
}

/** Display name for the active person: their answers' name, else "You" / the sample's name. */
export function personLabel(state: Pick<DeviceState, "person" | "profile">): string {
  if (state.profile?.name) return state.profile.name;
  return state.person === "me" ? "You" : DEMO_PROFILES[state.person]?.name ?? "You";
}

export type PlanStatusApi = {
  /** Status for an outing; Not started when there is no saved plan id. */
  statusFor(activityId: string): PlanStatus;
  /** Words + icon + action label for an outing, in the current mode. */
  viewFor(activityId: string): StatusView;
  /** true when the server returned 503: hide status words, show "Live status isn't available on this server". */
  unavailable: boolean;
};

/** Reads coordination plan status for saved plan ids on mount and whenever the page regains focus. */
export function usePlanStatus(): PlanStatusApi {
  const store = useStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, () => INITIAL_STATE);
  const planKey = Object.entries(state.plans).map(([a, p]) => `${a}=${p}`).sort().join("&");

  useEffect(() => {
    if (!state.ready) return;
    void store.refreshPlanStatus();
    const onFocus = () => void store.refreshPlanStatus();
    const onVisible = () => document.visibilityState === "visible" && onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store, state.ready, state.person, planKey]);

  const name = personLabel(state);
  const statusFor = (activityId: string) => state.planStatus[activityId] ?? NOT_STARTED;
  return {
    statusFor,
    viewFor: (activityId) => planStatusView(statusFor(activityId).state, state.mode, name),
    unavailable: state.liveStatus === "unavailable",
  };
}
