import { CoordinationError, createCoordinator, type Coordinator } from "@/domain/coordination/coordinator";
import { createMockProvider } from "@/domain/coordination/provider";
import type { z } from "zod";

// ponytail: in-memory store on globalThis (survives dev hot reload, lost on restart).
// Mock provider only: nothing is ever sent. Swap in a persistent store / live ProviderPort after the demo.
const g = globalThis as unknown as { __daybridgeCoordinator?: Coordinator };
export const coordinator = (g.__daybridgeCoordinator ??= createCoordinator({ provider: createMockProvider() }));

// Demo-only provider callback endpoint; disabled in production unless explicitly enabled.
export const demoEventsEnabled = () => process.env.NODE_ENV !== "production" || process.env.DAYBRIDGE_DEMO_EVENTS === "1";

// Hosted production has no auth or durable store yet (see PERSISTENCE_AUTH_PROPOSAL.md): fail closed.
// The local demo runs `next start` with DAYBRIDGE_DEMO_EVENTS=1, which keeps the full flow working there.
export const HOSTED_DISABLED = "Coordination runs in the local demo for now. The hosted version needs sign-in and storage first.";

export async function handle(fn: () => Promise<unknown>) {
  if (!demoEventsEnabled()) return Response.json({ error: HOSTED_DISABLED }, { status: 503 });
  try {
    return Response.json(await fn());
  } catch (err) {
    if (err instanceof CoordinationError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
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
