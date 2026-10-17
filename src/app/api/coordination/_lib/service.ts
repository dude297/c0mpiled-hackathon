import { CoordinationError, createCoordinator, type Coordinator } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import { createMemoryStore } from "@/domain/coordination/store";
import { getUserId } from "@/lib/supabase/auth";
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
const localDemo = () => process.env.NODE_ENV !== "production" || process.env.DAYBRIDGE_DEMO_EVENTS === "1";

// Supabase configured -> persistent store + verified user (cloud). Otherwise -> in-memory local demo, no auth.
export async function context(req: Request): Promise<Ctx | Response> {
  if (supabaseConfigured()) {
    const coordinator = (g.__daybridgeCloudCoordinator ??= createCoordinator({ provider: createMockProvider(), store: createSupabaseStore() }));
    const userId = await getUserId(req);
    if (!userId) return fail(401, "Sign in required");
    return { coordinator, userId, persistence: "supabase" };
  }
  if (!localDemo()) return fail(503, HOSTED_DISABLED);
  const coordinator = (g.__daybridgeCoordinator ??= createCoordinator({ provider: createMockProvider(), store: createMemoryStore() }));
  return { coordinator, userId: null, persistence: "memory" };
}

// Simulated provider callbacks. Local demo: as before (always in dev, DAYBRIDGE_DEMO_EVENTS=1 under `next start`).
// Cloud (Supabase configured) production: always 403. No public synthetic-event injection, by any flag or key.
export function demoEventsEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  return !supabaseConfigured() && process.env.DAYBRIDGE_DEMO_EVENTS === "1";
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

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | Response> {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json({ error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid input" }, { status: 400 });
  }
  return parsed.data;
}
