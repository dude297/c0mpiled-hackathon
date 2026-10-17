import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEMO_PROFILES } from "@/domain/activities";
import { CareApiError, CheckInDraft, canUseDeviceFallback, careErrorMessage, createCareApi, dependencyStatus, isAccessError, readableDate } from "./care-api";
import { CheckInForm } from "./BackendCareDashboard";

const labels = { storage: "memory", providers: "simulated", generatedAt: "2026-10-17T22:00:00Z" };
const personId = "7d1f0a52-4c1e-4b8a-9a0e-6d6179610001";
const checkIn = { checkInId: "check-in-1", kind: "ok", reporterRole: "caregiver", source: "app", at: "2026-10-17T22:00:00Z" };
const detail = {
  person: { personId, profile: DEMO_PROFILES.margaret, timezone: "America/New_York", checkInSchedule: null, createdAt: "2026-10-17T22:00:00Z", createdBy: "cg-dana" },
  plans: [], upcoming: [], attention: [], latestCheckIns: [], myScopes: ["view"], labels,
};
const json = (value: unknown, status = 200) => Response.json(value, { status });
const fetchWith = (value: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(json(value, status));

describe("caregiver UI API boundary", () => {
  it("loads the real overview with explicit demo caller, no caching, and no forged sign-in", async () => {
    const fetcher = fetchWith({ people: [], labels });
    expect(await createCareApi("cg-lee", fetcher).overview()).toEqual({ people: [], labels });
    const [path, options] = fetcher.mock.calls[0];
    expect(path).toBe("/api/caregiver/overview");
    expect(options).toMatchObject({ cache: "no-store", headers: { "x-daybridge-user": "cg-lee" } });
    expect(options?.headers).not.toHaveProperty("Authorization");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads server-scoped person permissions without treating manage as checkin", async () => {
    const fetcher = fetchWith({ ...detail, myScopes: ["view", "manage"] });
    const result = await createCareApi("cg-dana", fetcher).person(personId);
    expect(result.myScopes).toEqual(["view", "manage"]);
    expect(result.myScopes).not.toContain("checkin");
    expect(result.person.checkInSchedule).toBeNull();
    expect(fetcher.mock.calls[0][0]).toBe(`/api/caregiver/people/${personId}`);
  });

  it("preserves note redaction and reporter role returned by the server", async () => {
    const result = await createCareApi("cg-lee", fetchWith({ ...detail, latestCheckIns: [{ ...checkIn, hasNote: true }] })).person(personId);
    expect(result.latestCheckIns[0]).toMatchObject({ hasNote: true, reporterRole: "caregiver" });
    expect(result.latestCheckIns[0].note).toBeUndefined();
  });

  it("requires honesty labels and rejects an unexpected response instead of showing invented records", async () => {
    await expect(createCareApi("cg-dana", fetchWith({ people: [] })).overview()).rejects.toMatchObject({ status: 502 });
    await expect(createCareApi("cg-dana", fetchWith({ people: "not-an-array", labels })).overview()).rejects.toMatchObject({ status: 502 });
  });

  it.each([401, 403, 404])("a %i is an access failure and never a same-device fallback", async (status) => {
    const fetcher = fetchWith({ error: "denied", labels }, status);
    const error = await createCareApi("cg-lee", fetcher).person(personId).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CareApiError);
    expect(isAccessError(error)).toBe(true);
    expect(canUseDeviceFallback(error)).toBe(false);
    expect(careErrorMessage(error)).not.toContain("denied");
  });

  it("does not disclose whether a missing or unshared person exists", async () => {
    const error = await createCareApi("cg-lee", fetchWith({ error: "Person not found", labels }, 404)).person(personId).catch((failure: unknown) => failure);
    expect(careErrorMessage(error)).toBe("Person not found or not shared with you.");
  });

  it("503 enables only the explicitly labelled independent device demo", async () => {
    const error = await createCareApi("cg-dana", fetchWith({ error: "disabled", labels }, 503)).overview().catch((failure: unknown) => failure);
    expect(canUseDeviceFallback(error)).toBe(true);
    expect(isAccessError(error)).toBe(false);
    expect(careErrorMessage(error)).toContain("available in the local demo only");
  });

  it("network and timeout failures enable fallback, while malformed data and internal errors remain retryable errors", async () => {
    for (const failure of [new TypeError("offline"), new DOMException("Timeout", "TimeoutError")]) {
      const error = await createCareApi("cg-dana", vi.fn<typeof fetch>().mockRejectedValue(failure)).overview().catch((value: unknown) => value);
      expect(canUseDeviceFallback(error)).toBe(true);
      expect(isAccessError(error)).toBe(false);
    }
    for (const status of [400, 409, 500, 502]) expect(canUseDeviceFallback(new CareApiError(status, "Failure"))).toBe(false);
  });

  it("a cancelled stale identity request is not converted into a network fallback", async () => {
    const controller = new AbortController(); controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    const error = await createCareApi("cg-dana", vi.fn<typeof fetch>().mockRejectedValue(abort)).overview(controller.signal).catch((failure: unknown) => failure);
    expect(error).toBe(abort);
    expect(canUseDeviceFallback(error)).toBe(false);
  });

  it("POSTs an encoded attention id and keeps acknowledgement distinct from resolution", async () => {
    const itemId = "approval_needed:plan-1:v2";
    const fetcher = fetchWith({ itemId, acknowledgedByMe: true, labels });
    const result = await createCareApi("cg-dana", fetcher).acknowledge(itemId);
    expect(fetcher.mock.calls[0]).toMatchObject([`/api/caregiver/attention/approval_needed%3Aplan-1%3Av2/ack`, { method: "POST" }]);
    expect(result).toMatchObject({ itemId, acknowledgedByMe: true });
    expect(result).not.toHaveProperty("resolved");
  });

  it("passes through the opaque history cursor, with redacted check-in roles", async () => {
    const fetcher = fetchWith({ items: [{ at: checkIn.at, type: "checkin", summary: "Check-in: ok (caregiver)", checkIn }], nextCursor: "next-page", labels });
    const result = await createCareApi("cg-lee", fetcher).history(personId, "opaque/+?=&");
    expect(fetcher.mock.calls[0][0]).toBe(`/api/caregiver/people/${personId}/history?limit=20&cursor=opaque%2F%2B%3F%3D%26`);
    expect(result.nextCursor).toBe("next-page");
    expect(result.items[0].checkIn?.reporterRole).toBe("caregiver");
  });

  it("self uses the own-profile route without requesting caregiver records", async () => {
    const fetcher = fetchWith({ profile: DEMO_PROFILES.margaret, version: 1, labels });
    await createCareApi("self-maya", fetcher).profile(personId);
    expect(fetcher.mock.calls[0][0]).toBe(`/api/caregiver/people/${personId}/profile`);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ "x-daybridge-user": "self-maya" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("conflict error messages remain available for action-local recovery", async () => {
    const error = await createCareApi("cg-dana", fetchWith({ error: "The check-in key was already used", labels }, 409)).checkIn(personId, { kind: "ok", idempotencyKey: "retry-1" }).catch((failure: unknown) => failure);
    expect(careErrorMessage(error)).toBe("The check-in key was already used");
  });
});

describe("check-in retries and accessibility", () => {
  it("reuses a key after a lost POST response; a duplicate saves once, then rotates the next key", async () => {
    const keys = vi.fn().mockReturnValueOnce("first-key").mockReturnValueOnce("next-key");
    const draft = new CheckInDraft(keys);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("response lost")).mockResolvedValueOnce(json({ checkIn, duplicate: true, labels }));
    const api = createCareApi("cg-dana", fetcher);
    await expect(api.checkIn(personId, draft.submission("ok", "  Fine  "))).rejects.toMatchObject({ status: 0 });
    const saved = await api.checkIn(personId, draft.submission("ok", "Fine"));
    expect(saved.duplicate).toBe(true);
    expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { kind: "ok", note: "Fine", idempotencyKey: "first-key" }, { kind: "ok", note: "Fine", idempotencyKey: "first-key" },
    ]);
    draft.saved();
    expect(draft.submission("ok", "Fine").idempotencyKey).toBe("next-key");
  });

  it("editing details starts a fresh key, and blank notes are omitted", () => {
    let id = 0; const draft = new CheckInDraft(() => `key-${++id}`);
    expect(draft.submission("ok", "  ")).toEqual({ kind: "ok", idempotencyKey: "key-1" });
    expect(draft.submission("call", "")).toEqual({ kind: "call", idempotencyKey: "key-2" });
    expect(draft.submission("call", "Please call after lunch")).toMatchObject({ idempotencyKey: "key-3" });
  });

  it.each([true, false])("check-in markup has readable role wording and an accessible note counter (self=%s)", (self) => {
    const html = renderToStaticMarkup(createElement(CheckInForm, { api: createCareApi("cg-dana", fetchWith({})), personId, self, onSaved: () => {} }));
    expect(html).toContain(self ? "I&#x27;m OK" : "They&#x27;re OK");
    expect(html).toContain('aria-describedby="care-note-count care-checkin-help"');
    expect(html).toContain('maxLength="280"');
    expect(html).toContain("0/280 characters");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("doesn&#x27;t contact anyone or change any plan");
  });

  it("requested is never formatted as confirmed and unknown stays unknown", () => {
    expect(dependencyStatus("requested")).toBe("Requested, not confirmed yet");
    expect(dependencyStatus("not_requested")).toBe("Not requested yet");
    expect(dependencyStatus("confirmed")).toBe("Confirmed");
    expect(dependencyStatus("mystery")).toBe("Unknown");
  });

  it("calendar dates don't shift into the previous day in US timezones", () => {
    expect(readableDate("2026-10-18", "America/Los_Angeles", true)).toBe("Sunday, October 18, 2026");
    expect(readableDate("2026-10-18T00:30:00Z", "America/Los_Angeles")).toContain("Saturday, October 17, 2026");
    expect(readableDate("not-a-date", "America/Los_Angeles")).toBe("Date not set");
  });
});
