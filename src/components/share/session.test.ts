import { describe, expect, it } from "vitest";
import { activeStoredShares, shareRecord, shareSessionKey } from "./session";

const now = Date.parse("2026-10-17T12:00:00.000Z");
const share = { id: "share_a", url: "/plan/share_a", revokeToken: "private-capability", expiresAt: "2026-10-18T12:00:00.000Z", storage: "memory" };
const entry = (value: typeof share) => [shareSessionKey(value.id), JSON.stringify(shareRecord(value))] as const;

describe("creator share session records", () => {
  it("stores exactly id, revokeToken and expiry under a key scoped to the share id", () => {
    expect(shareRecord(share)).toEqual({ id: share.id, revokeToken: share.revokeToken, expiresAt: share.expiresAt });
    expect(shareSessionKey(share.id)).toBe("daybridge:share:share_a");
    expect(shareSessionKey(share.id)).not.toContain(share.revokeToken);
  });

  it("restores multiple active capabilities after serialization/reload", () => {
    const other = { ...share, id: "share_b", revokeToken: "another-capability" };
    expect(activeStoredShares([entry(share), entry(other)], now)).toEqual([shareRecord(share), shareRecord(other)]);
  });

  it("drops links at expiry and after expiry, retaining other links", () => {
    const expired = { ...share, id: "expired", expiresAt: new Date(now - 1).toISOString() };
    const boundary = { ...share, id: "boundary", expiresAt: new Date(now).toISOString() };
    expect(activeStoredShares([entry(expired), entry(boundary), entry(share)], now)).toEqual([shareRecord(share)]);
    expect(activeStoredShares([entry(share)], Date.parse(share.expiresAt))).toEqual([]);
  });

  it("ignores malformed, unrelated and mismatched records without losing valid links", () => {
    const key = shareSessionKey(share.id);
    expect(activeStoredShares([
      [key, "{"], [key, null], [key, "null"], [key, "{}"],
      [key, JSON.stringify({ ...share, revokeToken: "" })],
      [key, JSON.stringify({ ...share, expiresAt: "invalid" })],
      [key, JSON.stringify({ ...share, id: "other" })],
      ["unrelated", JSON.stringify(share)],
      [shareSessionKey("../bad"), JSON.stringify({ ...share, id: "../bad" })],
      entry(share),
    ], now)).toEqual([shareRecord(share)]);
  });
});
