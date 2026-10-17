"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_PROFILES } from "@/domain/activities";
import type { CoordinationEvent, CoordinationPlan, PlanCommand } from "@/lib/schema";
import { authFetch, cloudEnabled, ensureSession } from "@/lib/supabase/browser";

const PLAN_KEY = "daybridge.cloud.planId";
// "walk" is PROPOSED for Margaret with a ride + an invite action (both to Pat).
const CREATE_BODY = { profile: DEMO_PROFILES.margaret, activityId: "walk", contacts: [{ id: "c1", name: "Pat", canDrive: true }] };

function readStoredId() {
  try { return localStorage.getItem(PLAN_KEY); } catch { return null; }
}
function storeId(id: string | null) {
  try { if (id) localStorage.setItem(PLAN_KEY, id); else localStorage.removeItem(PLAN_KEY); } catch { /* storage blocked: plan just won't survive refresh */ }
}

async function api(url: string, init?: RequestInit) {
  const res = await authFetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${res.status}: ${data.error ?? res.statusText ?? "Request failed"}`), { status: res.status });
  return data as { plan: CoordinationPlan; events?: CoordinationEvent[]; outcome?: string; reason?: string };
}

export default function CloudPage() {
  const [who, setWho] = useState<string>("…");
  const [plan, setPlan] = useState<CoordinationPlan | null>(null);
  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [busy, setBusy] = useState<string | null>("Loading");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  }

  // Initial load: busy starts as "Loading", so no synchronous setState here.
  useEffect(() => {
    (async () => {
      const session = await ensureSession();
      setWho(session ? `Signed in as guest ${session.user.id.slice(0, 8)}` : "Local mode — not persisted");
      const id = readStoredId();
      if (!id) return;
      try {
        const data = await api(`/api/coordination/plans/${encodeURIComponent(id)}`);
        setPlan(data.plan);
        setEvents(data.events ?? []);
      } catch (e) {
        if ((e as { status?: number }).status === 404) storeId(null); // gone or not ours
        throw e;
      }
    })()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }, []);

  const create = () => run("Creating plan", async () => {
    const data = await api("/api/coordination/plans", { method: "POST", body: JSON.stringify(CREATE_BODY) });
    storeId(data.plan.id);
    setPlan(data.plan);
    setEvents(data.events ?? []);
  });

  const command = (label: string, cmd: PlanCommand) => run(label, async () => {
    if (!plan) return;
    const data = await api(`/api/coordination/plans/${encodeURIComponent(plan.id)}/commands`, { method: "POST", body: JSON.stringify(cmd) });
    setPlan(data.plan);
    setEvents((prev) => [...prev, ...(data.events ?? [])]);
    if (data.outcome && data.outcome !== "applied") setNote(`${data.outcome}${data.reason ? `: ${data.reason}` : ""}`);
  });

  const reset = () => { storeId(null); setPlan(null); setEvents([]); setError(null); setNote(null); };
  const proposed = plan?.actions.filter((a) => a.status === "proposed") ?? [];

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">DayBridge Cloud</h1>
        <Badge variant={cloudEnabled() ? "default" : "secondary"}>{who}</Badge>
      </div>

      {busy && <p className="text-sm text-muted-foreground">{busy}…</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {note && <p className="rounded-md border p-2 text-sm">{note}</p>}

      {!plan ? (
        <Card>
          <CardHeader><CardTitle>Plan an outing for Margaret</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Lakeside Morning Walkers, with Pat as a driver. The plan is saved to your guest account and survives a page refresh.</p>
            <Button onClick={create} disabled={!!busy}>Create plan</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {plan.activityName} <Badge>{plan.state}</Badge> <Badge variant="outline">{plan.dataSource}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{plan.when} · plan {plan.id.slice(0, 8)} · v{plan.version}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => command("Accepting", { type: "accept_proposal" })} disabled={!!busy || plan.state !== "PROPOSED"}>Accept proposal</Button>
              {proposed.map((a) => (
                <Button key={a.id} variant="outline" disabled={!!busy || plan.state !== "AWAITING_APPROVAL"}
                  onClick={() => command("Approving", { type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })}>
                  Approve {a.scope.kind} → {a.scope.recipientId}
                </Button>
              ))}
              <Button onClick={() => command("Executing", { type: "execute" })} disabled={!!busy}>Execute</Button>
              <Button variant="destructive" onClick={() => command("Cancelling", { type: "cancel" })} disabled={!!busy}>Cancel</Button>
              <Button variant="ghost" onClick={reset} disabled={!!busy}>New plan</Button>
            </div>

            <section>
              <h2 className="mb-1 font-medium">Actions</h2>
              {plan.actions.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                <ul className="space-y-1 text-sm">
                  {plan.actions.map((a) => <li key={a.id} className="flex gap-2"><Badge variant="secondary">{a.status}</Badge>{a.description}</li>)}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-1 font-medium">Dependencies</h2>
              {plan.dependencies.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {plan.dependencies.map((d) => <li key={d.id} className="flex gap-2"><Badge variant="secondary">{d.status}</Badge>{d.label}</li>)}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-1 font-medium">Events</h2>
              {events.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                <ol className="space-y-1 font-mono text-xs">
                  {events.map((e) => <li key={e.seq}>#{e.seq} {e.type} · {e.outcome}{e.reason ? ` · ${e.reason}` : ""}</li>)}
                </ol>
              )}
            </section>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
