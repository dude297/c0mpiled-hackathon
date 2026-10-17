import { CoordinationError, createCoordinator, type Coordinator, type SystemCaller } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import { createMemoryStore } from "@/domain/coordination/store";
import { getUserId } from "@/lib/supabase/auth";
import { rateLimit, retryAfterSec } from "@/lib/supabase/ratelimit";
import { supabaseConfigured } from "@/lib/supabase/server";
import { createSupabaseStore } from "@/lib/supabase/store";
import type { z } from "zod";

type Persistence = "memory" | "supabase";
export type Ctx = { coordinator: Coordinator; userId: string | null; persistence: Persistence };

// Mock provider only: nothing is ever sent. Live providers stay disabled.
// Coordinators are cached on globalThis (survives dev hot reload); the memory one is lost on restart.
const g = globalThis as unknown as { __daybridgeCoordinator?: Coordinator; __daybridgeCloudCoordinator?: Coordinator };

const fail = (status: number, error: string) => Response.json({ error }, { status });

// Without Supabase, hosted production fails closed (PR #22). The local demo runs `next start` with
// DAYBRIDGE_DEMO_EVENTS=1, which keeps the full in-memory flow working there.
export const HOSTED_DISABLED = "Coordination runs in the local demo for now. The hosted version needs sign-in and storage first.";
// Never on Vercel: a hosted deploy without Supabase must not fall back to public in-memory mode.
const localDemo = () => process.env.NODE_ENV !== "production" || (process.env.DAYBRIDGE_DEMO_EVENTS === "1" && !process.env.VERCEL);

// Per-user write limits (cloud mode only; the local memory demo is never limited).
export const LIMITS = { write: { limit: 60, windowSec: 60 }, create: { limit: 10, windowSec: 3600 } } as const;
const CREATE_PATHS = new Set(["/api/coordination/plans", "/api/coordination/demo"]);

async function overLimit(req: Request, userId: string): Promise<Response | null> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const buckets: (keyof typeof LIMITS)[] = CREATE_PATHS.has(new URL(req.url).pathname) ? ["write", "create"] : ["write"];
  for (const b of buckets) {
    const { limit, windowSec } = LIMITS[b];
    if (!(await rateLimit(`${b}:${userId}`, limit, windowSec)))
      return Response.json({ error: "Too many requests; try again shortly" }, { status: 429, headers: { "Retry-After": String(retryAfterSec(windowSec)) } });
  }
  return null;
}

// Supabase configured -> persistent store + verified user (cloud). Otherwise -> in-memory local demo, no auth.
// The coordinator for this deployment's mode: Supabase (cloud), in-memory (local demo), or null (fail closed).
// Also used by signed provider callbacks, which act for the system rather than a user.
export function systemCoordinator(): Coordinator | null {
  if (supabaseConfigured()) return (g.__daybridgeCloudCoordinator ??= createCoordinator({ provider: createMockProvider(), store: createSupabaseStore() }));
  if (!localDemo()) return null;
  return (g.__daybridgeCoordinator ??= createCoordinator({ provider: createMockProvider(), store: createMemoryStore() }));
}

// Caregiver lane facade. caregiver/_lib checks grants BEFORE calling it, so plan reads act for the system.
// Cloud plans are owned by the creating caregiver (the durable store requires a real owner); local plans stay
// unowned so /coordinate keeps working in the demo. Commands/ingest run as the unowned (null) caller: that reaches
// local-demo plans only; a cloud plan always has an owner, so they 404 there (no system-level writes).
const SYSTEM: SystemCaller = { system: true };
const need = () => {
  const c = systemCoordinator();
  if (!c) throw new CoordinationError(503, HOSTED_DISABLED);
  return c;
};
export const coordinator = {
  create: (input: Parameters<Coordinator["create"]>[0], ownerId?: string | null) => need().create(input, supabaseConfigured() ? ownerId : null),
  get: (id: string) => need().get(id, SYSTEM),
  command: (id: string, cmd: Parameters<Coordinator["command"]>[1]) => need().command(id, cmd, null),
  ingest: (id: string, ev: Parameters<Coordinator["ingest"]>[1]) => need().ingest(id, ev, null),
};

export async function context(req: Request): Promise<Ctx | Response> {
  const coordinator = systemCoordinator();
  if (!coordinator) return fail(503, HOSTED_DISABLED);
  if (!supabaseConfigured()) return { coordinator, userId: null, persistence: "memory" };
  const userId = await getUserId(req);
  if (!userId) return fail(401, "Sign in required");
  const limited = await overLimit(req, userId);
  if (limited) return limited;
  return { coordinator, userId, persistence: "supabase" };
}

// Simulated provider callbacks. Local demo: as before (always in dev, DAYBRIDGE_DEMO_EVENTS=1 under `next start`).
// Cloud (Supabase configured) production: always 403. No public synthetic-event injection, by any flag or key.
export function demoEventsEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  return !supabaseConfigured() && localDemo();
}

export async function handle(ctx: Ctx, fn: () => Promise<unknown>) {
  const headers = { "x-daybridge-persistence": ctx.persistence };
  try {
    return Response.json(await fn(), { headers });
  } catch (err) {
    if (err instanceof CoordinationError) return Response.json({ error: err.message }, { status: err.status, headers });
    // Stored-data validation failure, DB down, etc. Details stay server-side.
    console.error("coordination error:", err instanceof Error ? err.message : "unknown");
    return Response.json({ error: "Internal error" }, { status: 500, headers });
  }
}

const MAX_BODY_CHARS = 64_000; // largest valid input (profile + 10 contacts) is a few KB

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | Response> {
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_CHARS) return Response.json({ error: "Request body too large" }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid input" }, { status: 400 });
  }
  return parsed.data;
}
