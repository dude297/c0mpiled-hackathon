import { CoordinationError } from "@/domain/coordination/coordinator";
import { PROVIDERS, systemCoordinator, webhookSecret, type ProviderName } from "@/lib/providers/providers";
import { SIGNATURE_HEADER, verify } from "@/lib/providers/sign";
import { ProviderEvent } from "@/lib/schema";

// The only provider entry in production: signed callbacks from an allowlisted (simulated) provider.
// Disabled (404) unless PROVIDER_WEBHOOK_SECRET_<PROVIDER> (>= 32 chars) is set. Never accepts unsigned callbacks.
export const MAX_CALLBACK_BYTES = 16 * 1024;
const Callback = ProviderEvent.omit({ actor: true }).extend({ planId: ProviderEvent.shape.eventId }).strict();
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request, ctx: RouteContext<"/api/providers/[provider]/callback">) {
  const { provider } = await ctx.params;
  const secret = webhookSecret(provider);
  if (!secret) return json(404, { error: "Not found" });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_CALLBACK_BYTES) return json(413, { error: "Body too large" });
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw) > MAX_CALLBACK_BYTES) return json(413, { error: "Body too large" });
  if (!verify(secret, raw, req.headers.get(SIGNATURE_HEADER))) return json(401, { error: "Invalid signature" });

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  const parsed = Callback.safeParse(body);
  if (!parsed.success) return json(400, { error: "Invalid payload" });
  const { planId, ...rest } = parsed.data;
  // A provider may only speak for its own kind (a ride secret cannot forge invite RSVPs).
  if (!rest.type.startsWith(`${PROVIDERS[provider as ProviderName]}.`)) return json(400, { error: "Event type not allowed for this provider" });

  const coordinator = systemCoordinator();
  if (!coordinator) return json(503, { error: "Coordination unavailable" });
  try {
    const res = await coordinator.ingest(planId, { ...rest, actor: "provider" }, { system: true });
    // The provider learns the outcome only, never the user's plan.
    return json(200, { outcome: res.outcome, ...(res.reason ? { reason: res.reason } : {}) });
  } catch (err) {
    if (err instanceof CoordinationError) return json(err.status, { error: err.message });
    console.error("provider callback error:", err instanceof Error ? err.message : "unknown");
    return json(500, { error: "Internal error" });
  }
}
