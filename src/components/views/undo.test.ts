import { describe, expect, it, vi } from "vitest";
import { KEYS, SESSION_PROFILE_KEY } from "@/components/shell/helpers";
import type { Profile } from "@/lib/schema";
import { restoreSnapshot, takeSnapshot } from "./undo";

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const profile = { name: "Margaret" } as Profile;

describe("start over undo", () => {
  it("restores the person's raw keys and re-loads them through the store", () => {
    const local = mem({ [KEYS.profile("margaret")]: "P", [KEYS.week("margaret")]: "W", [KEYS.profile("harold")]: "H" });
    const session = mem({ [SESSION_PROFILE_KEY]: "S" });
    const store = { person: "margaret" as const, profile, storageOk: true, selectPerson: vi.fn(), analyze: vi.fn() };
    const snap = takeSnapshot(store, local, session);
    expect(snap.raw).toEqual({ [KEYS.profile("margaret")]: "P", [KEYS.week("margaret")]: "W" });
    local.m.clear();
    session.m.clear();
    restoreSnapshot(snap, store, local, session);
    expect(local.getItem(KEYS.week("margaret"))).toBe("W");
    expect(local.getItem(KEYS.profile("harold"))).toBeNull(); // only this person's keys
    expect(session.getItem(SESSION_PROFILE_KEY)).toBe("S");
    expect(store.selectPerson).toHaveBeenCalledWith("margaret");
    expect(store.analyze).not.toHaveBeenCalled();
  });

  it("falls back to re-analyzing the saved answers when storage is blocked", () => {
    const store = { person: "me" as const, profile, storageOk: false, selectPerson: vi.fn(), analyze: vi.fn() };
    const snap = takeSnapshot(store, null, null);
    expect(snap.raw).toBeNull();
    restoreSnapshot(snap, store, null, null);
    expect(store.analyze).toHaveBeenCalledWith(profile);
    expect(store.selectPerson).not.toHaveBeenCalled();
  });
});
