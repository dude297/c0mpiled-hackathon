// X1 handoff: /coordinate reads the active profile from sessionStorage "daybridge:profile" (SCREENS.md DS).
// The store writes it on analyze; a cached result skips analyze, so set it again before any link to X1.
import { SESSION_PROFILE_KEY } from "@/components/shell/helpers";
import type { Profile } from "@/lib/schema";

export function writeProfileHandoff(profile: Profile | null): void {
  if (!profile) return;
  try {
    window.sessionStorage.setItem(SESSION_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage blocked: /coordinate shows its own "start here" state.
  }
}
