// Undo for U6 "Start over". The store's reset() has no undo, so this keeps the person's raw saved keys
// and writes them back, then re-loads that person through the store (no API call while the cached result still matches).
import { KEYS, SESSION_PROFILE_KEY, personKeys, type PersonKey } from "@/components/shell/helpers";
import type { DeviceState, DeviceStore } from "@/components/shell/store";
import type { Profile } from "@/lib/schema";

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
export type Snapshot = { person: PersonKey; raw: Record<string, string> | null; session: string | null; profile: Profile | null };

type StoreLike = Pick<DeviceState, "person" | "profile" | "storageOk"> & Pick<DeviceStore, "selectPerson" | "analyze">;

function storage(kind: "localStorage" | "sessionStorage"): KV | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

export function takeSnapshot(s: StoreLike, local = storage("localStorage"), session = storage("sessionStorage")): Snapshot {
  let raw: Record<string, string> | null = null;
  if (s.storageOk && local) {
    try {
      raw = {};
      for (const k of personKeys(s.person)) {
        const v = local.getItem(k);
        if (v !== null) raw[k] = v;
      }
    } catch {
      raw = null;
    }
  }
  let sess: string | null = null;
  try {
    sess = session?.getItem(SESSION_PROFILE_KEY) ?? null;
  } catch {}
  return { person: s.person, raw, session: sess, profile: s.profile };
}

export function restoreSnapshot(snap: Snapshot, s: StoreLike, local = storage("localStorage"), session = storage("sessionStorage")): void {
  let restored = false;
  if (snap.raw && local && snap.raw[KEYS.profile(snap.person)]) {
    try {
      for (const [k, v] of Object.entries(snap.raw)) local.setItem(k, v);
      restored = true;
    } catch {}
  }
  try {
    if (snap.session !== null) session?.setItem(SESSION_PROFILE_KEY, snap.session);
  } catch {}
  if (restored) {
    s.selectPerson(snap.person);
  } else if (snap.profile && snap.person === s.person) {
    void s.analyze(snap.profile); // storage blocked: answers come back, the week is rebuilt from a fresh plan
  }
}
