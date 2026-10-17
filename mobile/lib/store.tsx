import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { runScenario, type DomainOutput } from '@/domain/engine';
import { cleanName } from '@/lib/copy';
import { AnalysisResult, type Profile } from '@/lib/schema';

export type ResultSource = 'server' | 'on-device';

export type AppState = {
  profile: Profile | null;
  // What they typed as their first name, or null. Use this — never profile.name — in on-screen copy:
  // profile.name is the engine's required placeholder ("Friend") when they left the name blank.
  firstName: string | null;
  result: AnalysisResult | null;
  source: ResultSource | null; // where `result` came from — label it honestly in the UI
  added: Set<string>; // activityIds on "My week"; resets to all plan items on each new result
  loading: boolean;
  error: string | null;
  analyze: (profile: Profile, firstName?: string | null) => Promise<void>; // firstName omitted = keep current
  toggleAdded: (activityId: string) => void;
  reset: () => void;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
const TIMEOUT_MS = 4000;

function explain(name: string | null, out: DomainOutput): string {
  if (!out.plan.length) {
    return `Nothing fits ${name ? `${name}'s` : 'your'} week yet. ${out.blocked.length} matching activit${out.blocked.length === 1 ? 'y is' : 'ies are'} blocked — see the reasons for each.`;
  }
  const names = out.plan.map((i) => `${i.name} (${i.when})`).join(', ');
  return name
    ? `Good fits for ${name} this week: ${names}. Each one matches their interests, schedule, budget and how they get around.`
    : `Good fits for you this week: ${names}. Each one matches your interests, schedule, budget and how you get around.`;
}

export function analyzeOnDevice(profile: Profile, firstName: string | null = null): AnalysisResult {
  const out = runScenario({ profile });
  return { ...out, explanation: explain(cleanName(firstName), out), dataSource: 'mock' };
}

async function analyzeOnServer(profile: Profile): Promise<AnalysisResult | null> {
  if (!API_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const parsed = AnalysisResult.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // offline, timeout, bad JSON — fall back silently
  } finally {
    clearTimeout(timer);
  }
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [source, setSource] = useState<ResultSource | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (p: Profile, name?: string | null) => {
    const shown = name === undefined ? firstName : cleanName(name);
    setProfile(p);
    setFirstName(shown);
    setLoading(true);
    setError(null);
    try {
      const server = await analyzeOnServer(p);
      const next = server ?? analyzeOnDevice(p, shown);
      setResult(next);
      setSource(server ? 'server' : 'on-device');
      setAdded(new Set(next.plan.map((i) => i.activityId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [firstName]);

  const toggleAdded = useCallback((id: string) => {
    setAdded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setProfile(null);
    setFirstName(null);
    setResult(null);
    setSource(null);
    setAdded(new Set());
    setError(null);
    setLoading(false);
  }, []);

  const value = useMemo<AppState>(
    () => ({ profile, firstName, result, source, added, loading, error, analyze, toggleAdded, reset }),
    [profile, firstName, result, source, added, loading, error, analyze, toggleAdded, reset],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
