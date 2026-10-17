"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Ban, Calendar, Check, CircleX, Clock, Hand, LoaderCircle, MessageCircle, RotateCcw, Send, Sparkles, ThumbsUp, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ActionRequest, CommandResult, CoordinationEvent, CoordinationPlan, Dependency,
} from "@/lib/schema";

// Coordination screen: DayBridge gets the person there, with consent at every step.
// Everything here consumes the Coordination contract v1.0.0 (see docs/daybridge/COORDINATION_CONTRACT.md).

const STATE_BANNER: Record<CoordinationPlan["state"], { sentence: string; tone: "red" | "amber" | "green" | "neutral" }> = {
  BLOCKED: { sentence: "Can't go yet — a hard barrier blocks this activity.", tone: "red" },
  PROPOSED: { sentence: "Here's what would make it work.", tone: "neutral" },
  AWAITING_APPROVAL: { sentence: "Needs your OK before we contact anyone.", tone: "amber" },
  PENDING_CONFIRMATION: { sentence: "Waiting for replies.", tone: "amber" },
  READY: { sentence: "You're all set ✓", tone: "green" },
  NEEDS_REPLAN: { sentence: "Something changed: here's a new plan.", tone: "amber" },
  COMPLETED: { sentence: "How did it go?", tone: "neutral" },
  CANCELLED: { sentence: "Plan cancelled.", tone: "neutral" },
};

const BANNER_CLS = {
  red: "bg-destructive/10 text-destructive ring-destructive/30",
  amber: "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800",
  green: "bg-green-100 text-green-900 ring-green-300 dark:bg-green-950/40 dark:text-green-200 dark:ring-green-800",
  neutral: "bg-muted text-foreground ring-border",
} as const;

const DEP_MARK: Record<Dependency["status"], { mark: string; cls: string; word: string }> = {
  not_requested: { mark: "·", cls: "text-muted-foreground", word: "Not requested" },
  requested: { mark: "⏳", cls: "text-amber-700 dark:text-amber-300", word: "Waiting" },
  confirmed: { mark: "✓", cls: "text-green-700 dark:text-green-400", word: "Confirmed" },
  declined: { mark: "✗", cls: "text-destructive", word: "Declined" },
  cancelled: { mark: "✗", cls: "text-destructive", word: "Cancelled" },
  failed: { mark: "✗", cls: "text-destructive", word: "Failed" },
};

function contactName(plan: CoordinationPlan, id: string): string {
  if (id === "paratransit") return "Paratransit service";
  return plan.contacts.find((c) => c.id === id)?.name ?? id;
}

function statusWord(a: ActionRequest): string {
  return {
    proposed: "Proposed",
    approved: "Approved — not sent yet",
    dispatched: "Sent",
    failed: "Failed — will replan",
    revoked: "Withdrawn",
    superseded: "Outdated",
  }[a.status];
}

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  pickupWindow: "pickup window",
  mobility: "mobility needs",
  activityName: "activity name",
  when: "date and time",
};

function storedProfile(): unknown {
  try {
    const raw = sessionStorage.getItem("daybridge:profile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function CoordinatePage() {
  return (
    <Suspense fallback={
      <main className="mx-auto w-full max-w-3xl p-6 text-base md:text-lg">
        <div className="flex items-center gap-3 py-16 text-muted-foreground" role="status">
          <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      </main>
    }>
      <CoordinateInner />
    </Suspense>
  );
}

function CoordinateInner() {
  const params = useSearchParams();
  const [plan, setPlan] = useState<CoordinationPlan | null>(null);
  const [events, setEvents] = useState<CoordinationEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seqCounter = useRef(new Map<string, number>());

  const apply = useCallback((r: CommandResult) => {
    setPlan(r.plan);
    setNotice(r.outcome === "applied" ? null : `${r.outcome}${r.reason ? `: ${r.reason}` : ""}`);
    if (r.outcome === "applied" || r.outcome === "duplicate") {
      for (const e of r.events) setEvents((prev) => [...prev, e]);
    }
  }, []);

  const command = useCallback(async (body: unknown) => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/coordination/plans/${plan.id}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      apply(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [plan, apply]);

  const simulate = useCallback(async (type: string, requestId: string) => {
    const seq = (seqCounter.current.get(requestId) ?? 0) + 1;
    seqCounter.current.set(requestId, seq);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/coordination/plans/${plan!.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          requestId,
          sequence: seq,
          type,
          actor: "demo",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      apply(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [plan, apply]);

  const loadDemo = useCallback(async () => {
    setBusy(true);
    setError(null);
    setEvents([]);
    seqCounter.current = new Map();
    try {
      const res = await fetch("/api/coordination/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityId: params.get("activityId") ?? "fellowship",
          // integration: opened from the planner's "Get me there" → same person; otherwise the Maya demo.
          profile: (params.get("activityId") && storedProfile()) || {
            name: "Maya",
            interests: ["faith"],
            mobility: "walker",
            transport: ["family", "paratransit"],
            maxTravelMin: 30,
            times: ["afternoon"],
            budgetPerWeek: 10,
            hearingImpaired: false,
            prefersSmallGroups: true,
          },
          contacts: [
            { id: "elaine", name: "Elaine", relation: "friend", canDrive: false },
            { id: "dan", name: "Dan", relation: "son", canDrive: true },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setPlan(data.plan);
      setEvents(data.events ?? []);
      setNotice(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [params]);

  useEffect(() => {
    if (!plan) {
      const t = setTimeout(() => void loadDemo(), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!plan) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6 text-base md:text-lg">
        <div className="flex items-center gap-3 py-16 text-muted-foreground" role="status">
          <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          {error ?? "Setting up the coordination demo…"}
        </div>
        <Button size="lg" onClick={loadDemo} disabled={busy}>Try again</Button>
      </main>
    );
  }

  const banner = STATE_BANNER[plan.state];
  const current = plan.actions.filter((a) => a.status !== "superseded");
  const awaiting = current.filter((a) => a.status === "proposed" || a.status === "approved");
  const newestFirst = [...events].sort((x, y) => y.seq - x.seq);
  const canSimulate = (kind: "invite" | "ride") =>
    current.find((a) => a.scope.kind === kind && a.status === "dispatched" && a.providerRequestId);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-base md:p-6 md:text-lg">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Hand className="size-6 text-primary" aria-hidden="true" />
          Get them there
        </h1>
        <Badge variant="secondary" className="h-6 px-3 text-sm">
          Simulated providers: no real messages or bookings are sent
        </Badge>
      </header>

      <section className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 ring-1 ${BANNER_CLS[banner.tone]}`} aria-live="polite">
        <div>
          <p className="text-xl font-semibold">{banner.sentence}</p>
          <p className="mt-0.5 text-sm md:text-base">
            {plan.activityName} · {plan.when} · for {plan.profile.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-7 px-3 text-sm">{plan.state}</Badge>
          <Badge variant="outline" className="h-7 px-3 text-sm">plan v{plan.version}</Badge>
        </div>
      </section>

      {notice && <p className="rounded-md bg-muted p-2 text-sm md:text-base">{notice}</p>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive md:text-base">{error}</p>}

      {plan.state === "BLOCKED" && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Ban className="size-5 text-destructive" aria-hidden="true" />Hard blockers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {plan.blockers.map((b) => (
              <p key={b.rule} className="flex items-start gap-2 font-medium text-destructive">
                <CircleX className="mt-1 size-4 shrink-0" aria-hidden="true" />{b.detail}
              </p>
            ))}
            {plan.alternatives.length > 0 && (
              <div className="pt-2">
                <p className="mb-2 font-medium">Try instead:</p>
                <div className="flex flex-wrap gap-2">
                  {plan.alternatives.map((alt) => (
                    <Button key={alt.activityId} variant="outline" size="lg" disabled={busy}
                      onClick={() => command({ type: "choose_alternative", activityId: alt.activityId })}>
                      {alt.name} ({alt.when})
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {plan.interventions.length > 0 && plan.state === "PROPOSED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">The smallest fix that works</CardTitle>
            <CardDescription className="text-sm md:text-base">Nothing is sent to anyone until you approve it below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {plan.interventions.map((i) => (
              <p key={i.id} className="flex items-start gap-2">
                {i.kind === "ride" && <Calendar className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />}
                {i.kind === "invite" && <Users className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />}
                {i.kind === "user_step" && <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />}
                {i.description}
              </p>
            ))}
            <Button size="lg" className="mt-2" disabled={busy} onClick={() => command({ type: "accept_proposal" })}>
              Accept plan
            </Button>
          </CardContent>
        </Card>
      )}

      {plan.state === "NEEDS_REPLAN" && (
        <Card className="ring-amber-300 dark:ring-amber-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl"><RotateCcw className="size-5 text-amber-700 dark:text-amber-300" aria-hidden="true" />Recovery plan</CardTitle>
            <CardDescription className="text-sm md:text-base">Confirmed steps that still hold are kept; everything else needs your approval again.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {plan.interventions.map((i) => (
              <p key={i.id} className="flex items-start gap-2">
                <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />{i.description}
              </p>
            ))}
            {plan.alternatives.length > 0 && (
              <div>
                <p className="mb-2 font-medium">Or try instead:</p>
                <div className="flex flex-wrap gap-2">
                  {plan.alternatives.map((alt) => (
                    <Button key={alt.activityId} variant="outline" size="lg" disabled={busy}
                      onClick={() => command({ type: "choose_alternative", activityId: alt.activityId })}>
                      {alt.name} ({alt.when})
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <Button size="lg" disabled={busy} onClick={() => command({ type: "accept_proposal" })}>Accept new plan</Button>
          </CardContent>
        </Card>
      )}

      {(plan.state === "AWAITING_APPROVAL" || plan.state === "NEEDS_REPLAN" || plan.state === "BLOCKED") && awaiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Your approval, action by action</CardTitle>
            <CardDescription className="text-sm md:text-base">
              We contact exactly these people, sharing exactly these fields — nothing more.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {awaiting.map((a) => {
              const approved = a.status === "approved";
              return (
                <div key={a.id} className="rounded-xl border p-3">
                  <p className="font-semibold">{contactName(plan, a.scope.recipientId)} — {a.scope.kind === "ride" ? "ask for a ride" : "invite"}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground md:text-base">{a.description}</p>
                  <p className="mt-1 text-sm md:text-base">When: {a.scope.when}</p>
                  <p className="mt-1 text-sm md:text-base">
                    Shares: {a.scope.sharedFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={approved ? "default" : "secondary"}>{statusWord(a)}</Badge>
                    {!approved && (
                      <Button size="lg" disabled={busy}
                        onClick={() => command({ type: "approve", actionId: a.id, scope: a.scope, expiresAt: new Date(Date.now() + 3600_000).toISOString() })}>
                        Approve
                      </Button>
                    )}
                    {approved && (
                      <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "revoke", actionId: a.id })}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {plan.state === "AWAITING_APPROVAL" && current.some((a) => a.status === "approved") && (
              <Button size="lg" className="w-full" disabled={busy} onClick={() => command({ type: "execute" })}>
                <Send aria-hidden="true" />Send requests
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {plan.dependencies.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-xl">Confirmations</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {plan.dependencies.map((d) => {
                const mark = DEP_MARK[d.status];
                return (
                  <li key={d.id} className="flex items-center gap-2">
                    <span className={`w-5 text-center ${mark.cls}`} aria-hidden="true">{mark.mark}</span>
                    <span className="flex-1">{d.label}</span>
                    <Badge variant={d.status === "confirmed" ? "default" : d.status === "requested" ? "secondary" : "destructive"}>
                      {mark.word}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {plan.state === "READY" && (
        <Card className="ring-green-300 dark:ring-green-800">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-medium">
              <Check className="size-5 text-green-700 dark:text-green-400" aria-hidden="true" />
              Every confirmation is in — {plan.profile.name} can go.
            </p>
            <Button size="lg" disabled={busy} onClick={() => command({ type: "complete", attended: true })}>
              <ThumbsUp aria-hidden="true" />Mark as attended
            </Button>
          </CardContent>
        </Card>
      )}

      {plan.state === "COMPLETED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">How did it go?</CardTitle>
            <CardDescription className="text-sm md:text-base">
              Your answer updates their preferences — only after you confirm the change.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "feedback", signals: ["enjoyed"] })}>
                <MessageCircle className="size-4" aria-hidden="true" />Loved it
              </Button>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "feedback", signals: ["too_crowded"] })}>Too crowded</Button>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "feedback", signals: ["too_far"] })}>Too far</Button>
              <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "feedback", signals: ["too_expensive"] })}>Too expensive</Button>
            </div>
            {plan.preferencePatches.filter((p) => p.status === "proposed").map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <p className="font-medium">
                  I heard: {p.field === "prefersSmallGroups" ? "prefer small groups" : p.field === "maxTravelMin" ? `max travel ${p.to} min` : `budget $${p.to}/week`}
                  {" "}(was: {p.from})
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="lg" disabled={busy} onClick={() => command({ type: "confirm_preference", patchId: p.id })}>Confirm</Button>
                  <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "reject_preference", patchId: p.id })}>No</Button>
                </div>
              </div>
            ))}
            {plan.preferencePatches.some((p) => p.status === "applied") && (
              <p className="text-sm text-muted-foreground md:text-base">Preference updated (profile v{plan.profileVersion}).</p>
            )}
          </CardContent>
        </Card>
      )}

      {current.some((a) => a.providerRequestId) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="size-5 text-primary" aria-hidden="true" />Demo: simulate replies</CardTitle>
            <CardDescription className="text-sm md:text-base">Stands in for the real texts and confirmations from people and services.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(() => {
              const invite = canSimulate("invite");
              const ride = canSimulate("ride");
              return (
                <>
                  <Button variant="outline" size="lg" disabled={busy || !invite} onClick={() => simulate("invite.accepted", invite!.providerRequestId!)}>
                    Elaine accepts
                  </Button>
                  <Button variant="outline" size="lg" disabled={busy || !invite} onClick={() => simulate("invite.declined", invite!.providerRequestId!)}>
                    Elaine declines
                  </Button>
                  <Button variant="outline" size="lg" disabled={busy || !ride} onClick={() => simulate("ride.confirmed", ride!.providerRequestId!)}>
                    Ride confirmed
                  </Button>
                  <Button variant="outline" size="lg" disabled={busy || !ride} onClick={() => simulate("ride.cancelled", ride!.providerRequestId!)}>
                    Ride cancelled
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {newestFirst.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Clock className="size-5 text-primary" aria-hidden="true" />Event timeline</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm md:text-base">
              {newestFirst.map((e) => {
                const dim = e.outcome !== "applied";
                return (
                  <li key={e.seq} className={dim ? "text-muted-foreground" : ""}>
                    <span className="font-mono text-xs">#{e.seq}</span>{" "}
                    <b>{e.type}</b> · {e.actor} · {e.outcome}
                    {e.reason && <span> — {e.reason}</span>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <footer className="flex flex-wrap gap-2 pb-6 print:hidden">
        <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "cancel" })}>Cancel plan</Button>
        <Button variant="ghost" size="lg" disabled={busy} onClick={loadDemo}>
          <RotateCcw className="size-4" aria-hidden="true" />Restart demo
        </Button>
      </footer>
    </main>
  );
}
