import { sanitize } from "@/lib/ai/intake/parse";
import type { Profile } from "@/lib/schema";

// Base profile overlaid with the suggestion. Only known Profile keys whose value passes that key's schema are taken
// (reuses the server-side sanitizer), so unknown keys and junk from the network never reach the form.
export function mergeSuggestion(base: Profile, suggestion: unknown): Profile {
  return { ...base, ...sanitize(suggestion) };
}
