import { z } from "zod";
import type { ShareCreated } from "./request";

const StoredShare = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  revokeToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type StoredShare = z.infer<typeof StoredShare>;
export const SHARE_SESSION_PREFIX = "daybridge:share:";
export const shareSessionKey = (id: string) => `${SHARE_SESSION_PREFIX}${id}`;

export function shareRecord(share: ShareCreated): StoredShare {
  return { id: share.id, revokeToken: share.revokeToken, expiresAt: share.expiresAt };
}

export function activeStoredShares(entries: ReadonlyArray<readonly [string, string | null]>, now: number): StoredShare[] {
  const active: StoredShare[] = [];
  for (const [key, raw] of entries) {
    if (!key.startsWith(SHARE_SESSION_PREFIX) || !raw) continue;
    try {
      const parsed = StoredShare.safeParse(JSON.parse(raw));
      if (parsed.success && key === shareSessionKey(parsed.data.id) && Date.parse(parsed.data.expiresAt) > now) {
        active.push(parsed.data);
      }
    } catch { /* Ignore malformed entries without hiding other links. */ }
  }
  return active;
}
