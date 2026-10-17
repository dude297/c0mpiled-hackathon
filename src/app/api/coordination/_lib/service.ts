import { timingSafeEqual } from "node:crypto";
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

// Supabase configured -> persistent store + verified user. Production without Supabase fails closed.
// Otherwise (local dev/tests) -> in-memory store, no auth.
export async function context(req: Request): Promise<Ctx | Response> {
  if (supabaseConfigured()) {
    const coordinator = (g.__daybridgeCloudCoordinator ??= createCoordinator({ provider: createMockProvider(), store: createSupabaseStore() }));
    const userId = await getUserId(req);
    if (!userId) return fail(401, "Sign in required");
    return { coordinator, userId, persistence: "supabase" };
  }
  if (process.env.NODE_ENV === "production") return fail(503, "Coordination persistence is not configured");
  const coordinator = (g.__daybridgeCoordinator ??= createCoordinator({ provider: createMockProvider(), store: createMemoryStore() }));
  return { coordinator, userId: null, persistence: "memory" };
}

// Demo-only provider callback endpoint. In production it needs DAYBRIDGE_DEMO_EVENTS=1 AND a matching
// x-daybridge-demo-key header (DAYBRIDGE_DEMO_KEY, at least 32 chars).
export function demoEventsEnabled(req: Request) {
  if (process.env.NODE_ENV !== "production") return true;
  const key = process.env.DAYBRIDGE_DEMO_KEY ?? "";
  if (process.env.DAYBRIDGE_DEMO_EVENTS !== "1" || key.length < 32) return false;
  const a = Buffer.from(req.headers.get("x-daybridge-demo-key") ?? "");
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
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
