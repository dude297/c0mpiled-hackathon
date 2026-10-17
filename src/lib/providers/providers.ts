import { MIN_SECRET_LENGTH } from "./sign";

// Simulated providers only. Each may only report events of its own kind.
export const PROVIDERS = { "mock-ride": "ride", "mock-invite": "invite" } as const;
export type ProviderName = keyof typeof PROVIDERS;

// Server-only secret, e.g. PROVIDER_WEBHOOK_SECRET_MOCK_RIDE. Unknown provider, unset or short secret -> null (endpoint disabled).
export function webhookSecret(provider: string): string | null {
  if (!Object.hasOwn(PROVIDERS, provider)) return null;
  const s = process.env[`PROVIDER_WEBHOOK_SECRET_${provider.toUpperCase().replace(/-/g, "_")}`];
  return s && s.length >= MIN_SECRET_LENGTH ? s : null;
}

// The coordinator without a user: the same instance (and per-plan lock) as the user routes. null = fail closed.
export { systemCoordinator } from "@/app/api/coordination/_lib/service";
