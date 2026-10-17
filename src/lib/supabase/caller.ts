import type { CallerResolver } from "@/app/api/caregiver/_lib/caller";
import { getUserId } from "./auth";

// Cloud caller: the verified Supabase session user (Authorization: Bearer <jwt>). Never reads x-daybridge-user.
// Wiring rule (caregiver/_lib/service.ts): supabaseConfigured() → this resolver, always; header resolver only without Supabase.
export const supabaseCallerResolver: CallerResolver = { resolve: getUserId };
