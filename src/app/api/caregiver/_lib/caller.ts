import { UserId } from "@/domain/caregiver/contract";

// Verified-identity port. The local demo trusts the x-daybridge-user header; the cloud lane supplies a
// Supabase-session implementation. null → 401. The hosted fail-closed (503) decision lives in service.ts, not here.
export interface CallerResolver {
  resolve(req: Request): Promise<string | null>;
}

export const DEMO_USER_HEADER = "x-daybridge-user";

export const headerCallerResolver: CallerResolver = {
  async resolve(req) {
    const v = req.headers.get(DEMO_USER_HEADER);
    return v && UserId.safeParse(v).success ? v : null;
  },
};
