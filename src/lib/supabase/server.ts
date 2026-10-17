import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only privileged client. SUPABASE_SECRET_KEY must never carry a NEXT_PUBLIC_ prefix.
export const supabaseConfigured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

let admin: SupabaseClient | undefined;
export function adminClient(): SupabaseClient {
  if (!supabaseConfigured()) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY)");
  return (admin ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
