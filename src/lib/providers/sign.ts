import { createHmac, timingSafeEqual } from "node:crypto";

// Provider callback signatures: `x-daybridge-signature: t=<unix seconds>,v1=<hex hmac-sha256(secret, `${t}.${rawBody}`)>`.
export const SIGNATURE_HEADER = "x-daybridge-signature";
export const REPLAY_WINDOW_SEC = 300;
export const MIN_SECRET_LENGTH = 32;

const hmac = (secret: string, body: string, t: number) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

export function sign(secret: string, body: string, t: number = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${hmac(secret, body, t)}`;
}

// True only for a well-formed header whose HMAC matches and whose timestamp is within the replay window.
export function verify(secret: string, body: string, header: string | null, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSec - t) > REPLAY_WINDOW_SEC) return false;
  return timingSafeEqual(Buffer.from(m[2], "hex"), Buffer.from(hmac(secret, body, t), "hex"));
}
