"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowRight, Ban, Calendar, Check, CircleX, Clock, Hand, LoaderCircle, MessageCircle, RotateCcw, Send, Sparkles, ThumbsUp, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ActionRequest, CommandResult, CoordinationEvent, CoordinationPlan, Dependency,
} from "@/lib/schema";
import { describePlan } from "@/domain/coordination/narrative";

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
  const contact = plan.contacts.find((c) => c.id === id);
  return contact ? `Sample contact (${contact.name})` : "Sample contact";
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

// ---- presentation helpers (read-only views of the real plan + event log; no state logic) ----

const STEPS: { state: CoordinationPlan["state"]; label: string }[] = [
  { state: "PROPOSED", label: "Plan" },
  { state: "AWAITING_APPROVAL", label: "Your OK" },
  { state: "PENDING_CONFIRMATION", label: "Waiting for replies" },
  { state: "READY", label: "Ready" },
  { state: "COMPLETED", label: "Done" },
];

// Where the current state sits on the tracker. NEEDS_REPLAN / BLOCKED send the plan back to step 1.
function stepIndex(state: CoordinationPlan["state"]): number {
  if (state === "NEEDS_REPLAN" || state === "BLOCKED") return 0;
  if (state === "CANCELLED") return -1;
  return STEPS.findIndex((s) => s.state === state);
}

const FAILED_DEP = new Set<Dependency["status"]>(["declined", "cancelled", "failed"]);

function eventAction(plan: CoordinationPlan, e: CoordinationEvent): ActionRequest | undefined {
  const p = e.payload;
  if (typeof p.actionId === "string") return plan.actions.find((a) => a.id === p.actionId);
  if (typeof p.dependencyId === "string") {
    const dep = plan.dependencies.find((d) => d.id === p.dependencyId);
    if (dep) return plan.actions.find((a) => a.id === dep.actionId);
  }
  if (typeof p.requestId === "string") return plan.actions.find((a) => a.providerRequestId === p.requestId);
  return undefined;
}

const ACTOR_WORD: Record<CoordinationEvent["actor"], string> = {
  user: "You",
  agent: "DayBridge",
  provider: "Service (simulated)",
  demo: "Demo reply (simulated)",
};

// Plain-language timeline text; never expose unknown event codes.
function eventText(plan: CoordinationPlan, e: CoordinationEvent): string {
  const a = eventAction(plan, e);
  const who = a ? contactName(plan, a.scope.recipientId) : "Someone";
  const req = a ? (a.scope.kind === "invite" ? `the invite to ${who}` : a.scope.recipientId === "paratransit" ? "the paratransit ride" : `the ride request to ${who}`) : "a request";
  switch (e.type) {
    case "plan.created": return "Started a plan";
    case "plan.proposed": return "DayBridge proposed a plan";
    case "plan.blocked": return "DayBridge found a hard barrier";
    case "accept_proposal": case "command.accept_proposal": return "You accepted the plan";
    case "action.approved": return `You approved ${req}`;
    case "action.revoked": return `You withdrew approval for ${req}`;
    case "actions.superseded": return "Old requests replaced by the new plan";
    case "execute": case "command.execute": return "You sent the approved requests (simulated)";
    case "invite.requested": return `Invite sent to ${who} (simulated)`;
    case "ride.requested": return `Ride request sent to ${who} (simulated)`;
    case "invite.failed": case "ride.failed": return `Couldn't reach ${who}`;
    case "invite.dispatch_error": case "ride.dispatch_error": return `Couldn't reach ${who} yet — safe to try again`;
    case "invite.accepted": return `${who} accepted the invite`;
    case "invite.declined": return `${who} declined the invite`;
    case "ride.confirmed": return `${who} confirmed the ride`;
    case "ride.declined": return `${who} declined the ride`;
    case "ride.cancelled": return `${who} cancelled the ride`;
    case "plan.ready": return "Everything confirmed — plan is ready";
    case "plan.ready_revoked": return "Plan is no longer ready";
    case "plan.replan_required": return "DayBridge worked out a new plan";
    case "choose_alternative": case "command.choose_alternative": return "You switched to another activity";
    case "plan.cancelled": return "You cancelled the plan";
    case "plan.completed": return e.payload.attended === false ? "Marked as not attended" : "Marked as attended";
    case "feedback.preference_proposed": return "DayBridge suggested a preference change";
    case "preference.updated": return "You confirmed a preference change";
    case "preference.rejected": return "You turned down a preference change";
    default: return "Plan updated";
  }
}

function eventTone(e: CoordinationEvent): "ok" | "warn" | "muted" | "plain" {
  if (e.outcome !== "applied") return "muted";
  if (/\.(cancelled|declined|failed)$|ready_revoked|plan\.blocked/.test(e.type)) return "warn";
  if (/\.(confirmed|accepted)$|^plan\.ready$/.test(e.type)) return "ok";
  return "plain";
}

const OUTCOME_WORD: Record<CoordinationEvent["outcome"], string> = {
  applied: "",
  duplicate: "already done, ignored",
  ignored: "ignored",
  rejected: "not allowed",
};

function formatTime(at: string): string {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function ProgressBar({ value, total, label, tone = "primary" }: { value: number; total: number; label: string; tone?: "primary" | "green" }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium md:text-base">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        className="h-3 w-full overflow-hidden rounded-full bg-muted ring-1 ring-border"
      >
        <div
          className={`db-progress h-full rounded-full ${tone === "green" ? "bg-green-600 dark:bg-green-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PulseDot() {
  return (
    <span className="relative inline-flex size-3 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex size-full rounded-full bg-amber-500 opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-3 rounded-full bg-amber-500" />
    </span>
  );
}

function StepTracker({ state }: { state: CoordinationPlan["state"] }) {
  const idx = stepIndex(state);
  const replan = state === "NEEDS_REPLAN";
  const blocked = state === "BLOCKED";
  return (
    <nav aria-label="Plan progress">
      <ol className="grid grid-cols-5 gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const done = idx > i || (state === "COMPLETED" && i === idx);
          const isCurrent = i === idx;
          const label = isCurrent && replan ? "New plan" : isCurrent && blocked ? "Blocked" : s.label;
          const dot = isCurrent
            ? replan
              ? "bg-amber-500 text-white ring-4 ring-amber-300 dark:ring-amber-800"
              : blocked
                ? "bg-destructive text-white ring-4 ring-destructive/30"
                : "bg-primary text-primary-foreground ring-4 ring-primary/30"
            : done
              ? "bg-green-600 text-white dark:bg-green-500"
              : "bg-muted text-muted-foreground ring-1 ring-border";
          return (
            <li key={s.state} aria-current={isCurrent ? "step" : undefined} className="flex flex-col items-center gap-1 text-center">
              <span
                key={isCurrent ? `${state}-current` : s.state}
                className={`flex size-9 items-center justify-center rounded-full text-sm font-bold ${dot} ${isCurrent ? "db-pop" : ""}`}
              >
                {done && !isCurrent ? <Check className="size-5" aria-hidden="true" />
                  : isCurrent && replan ? <RotateCcw className="size-5" aria-hidden="true" />
                    : isCurrent && blocked ? <Ban className="size-5" aria-hidden="true" />
                      : i + 1}
              </span>
              <span className={`text-xs leading-tight sm:text-sm ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {label}
                {done && !isCurrent && <span className="sr-only"> (done)</span>}
                {isCurrent && <span className="sr-only"> (current step)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function storedProfile(): unknown {
  try {
    const raw = sessionStorage.getItem("daybridge:profile");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function BackToMatches() {
  const router = useRouter();
  return (
    <Link href="/" className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 font-medium text-primary underline underline-offset-4"
      onNavigate={(event) => {
        if (window.history.length > 1) {
          event.preventDefault();
          router.back();
        }
      }}>
      ← Back to my matches
    </Link>
  );
}

// Contacts supplied by this demo are fixtures, not people entered by the user.
function sampleContactText(plan: CoordinationPlan, text: string): string {
  return plan.contacts.reduce((copy, contact) =>
    copy.replaceAll(contact.name, `Sample contact (${contact.name})`), text);
}

export default function CoordinatePage() {
  return (
    <Suspense fallback={
      <main className="mx-auto w-full max-w-3xl p-6 text-base md:text-lg">
        <BackToMatches />
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
    // append every event the server emitted — ignored/rejected entries belong on the timeline too
    for (const e of r.events) setEvents((prev) => [...prev, e]);
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
      if (!res.ok) {
        // integration: a stale/invalid stored profile must not wedge the page; the retry falls back to the Maya demo.
        try {
          sessionStorage.removeItem("daybridge:profile");
        } catch {}
        throw new Error(data.error ?? "Request failed");
      }
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
        <BackToMatches />
        <div className="flex items-center gap-3 py-16 text-muted-foreground" role="status">
          <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          {error ? "That didn’t go through — try again or go back to your matches." : "Setting up the coordination demo…"}
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

  // Read-only presentation views of the real plan.
  const narrative = describePlan(plan);
  const approvedCount = awaiting.filter((a) => a.status === "approved").length;
  const currentIds = new Set(current.map((a) => a.id));
  const liveDeps = plan.dependencies.filter((d) => currentIds.has(d.actionId));
  const confirmedCount = liveDeps.filter((d) => d.status === "confirmed").length;
  const depWho = (d: Dependency) => {
    const a = plan.actions.find((x) => x.id === d.actionId);
    return a ? contactName(plan, a.scope.recipientId) : null;
  };
  // What broke (newest applied failure event) and what replaced it — only shown in NEEDS_REPLAN.
  const lastFailure = plan.state === "NEEDS_REPLAN"
    ? newestFirst.find((e) => e.outcome === "applied" && /^(ride|invite)\.(cancelled|declined|failed)$/.test(e.type))
    : undefined;
  const readyRevoked = !!lastFailure && events.some((e) => e.type === "plan.ready_revoked" && e.seq > lastFailure.seq);
  const newOptions = plan.state === "NEEDS_REPLAN" ? current.filter((a) => a.status === "proposed") : [];
  const failureHeadline = (() => {
    if (!lastFailure) return null;
    return eventText(plan, lastFailure);
  })();

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-4 break-words p-4 text-base md:p-6 md:text-lg">
      <BackToMatches />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Hand className="size-6 text-primary" aria-hidden="true" />
          Get them there
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {busy && (
            <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Updating…
            </span>
          )}
          <Badge variant="secondary" className="h-auto min-h-6 whitespace-normal px-3 py-1 text-sm">
            Demo: nothing is really sent
          </Badge>
        </div>
      </header>

      <section className={`space-y-4 rounded-xl p-4 ring-1 ${BANNER_CLS[banner.tone]}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div aria-live="polite">
            <div key={plan.state} className="db-pop">
              <p className="text-xl font-semibold">{banner.sentence}</p>
              <p className="mt-0.5 text-sm md:text-base">
                {plan.activityName} · {plan.when} · for {plan.profile.name}
              </p>
            </div>
          </div>
          {plan.version > 1 && (
            <Badge key={plan.version} variant="outline" className="db-pop h-7 px-3 text-sm">Updated plan</Badge>
          )}
        </div>
        <StepTracker state={plan.state} />
        {plan.state === "CANCELLED" && (
          <p className="text-sm md:text-base">This plan was stopped — nothing further will be sent.</p>
        )}
        {narrative.nextStep && (
          <p key={narrative.nextStep} className="db-fade-up flex items-start gap-2 rounded-lg bg-background/70 p-3 text-sm font-medium text-foreground ring-1 ring-border md:text-base">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary md:mt-1" aria-hidden="true" />
            <span><span className="sr-only">Next step: </span>{sampleContactText(plan, narrative.nextStep)}</span>
          </p>
        )}
      </section>

      {notice && <p className="rounded-md bg-muted p-2 text-sm md:text-base">That didn’t go through — try the other option.</p>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive md:text-base">That didn’t go through — try the other option.</p>}

      {plan.state === "NEEDS_REPLAN" && failureHeadline && (
        <section
          key={`fail-${lastFailure!.seq}`}
          role="alert"
          className="db-flash-warn flex items-start gap-3 rounded-xl bg-destructive/10 p-4 text-destructive ring-2 ring-destructive/40"
        >
          <AlertTriangle className="mt-1 size-6 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-lg font-semibold md:text-xl">
              {failureHeadline} — {readyRevoked ? "plan is no longer ready." : "this plan won't work as is."}
            </p>
            <p className="mt-0.5 text-sm text-foreground md:text-base">
              {newOptions.length > 0 ? "DayBridge already worked out another way — see the new plan below." : "DayBridge looked for another way — see the options below."}
            </p>
          </div>
        </section>
      )}

      {plan.state === "BLOCKED" && (
        <Card className="db-fade-up">
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
                    <Button key={alt.activityId} variant="outline" size="lg" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy}
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

      {plan.state === "PROPOSED" && (
        <Card className="db-fade-up">
          <CardHeader>
            <CardTitle className="text-xl">{plan.interventions.length > 0 ? "The smallest fix that works" : "Nothing to arrange"}</CardTitle>
            <CardDescription className="text-sm md:text-base">
              {plan.interventions.length > 0
                ? "Nothing is sent to anyone until you approve it below."
                : "You can go on your own — no rides or invites needed. Confirm your plan below."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="db-stagger space-y-2">
              {plan.interventions.map((i) => (
                <p key={i.id} className="flex items-start gap-2">
                  {i.kind === "ride" && <Calendar className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />}
                  {i.kind === "invite" && <Users className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />}
                  {i.kind === "user_step" && <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />}
                  {sampleContactText(plan, i.description)}
                </p>
              ))}
            </div>
            <Button size="lg" className="mt-2 min-h-11 w-full sm:w-auto" disabled={busy} onClick={() => command({ type: "accept_proposal" })}>
              {plan.interventions.length === 0 ? "Confirm my plan" : "Accept plan"}
            </Button>
          </CardContent>
        </Card>
      )}

      {plan.state === "NEEDS_REPLAN" && (
        <Card className="db-fade-up ring-amber-300 dark:ring-amber-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl"><RotateCcw className="size-5 text-amber-700 dark:text-amber-300" aria-hidden="true" />Recovery plan</CardTitle>
            <CardDescription className="text-sm md:text-base">Confirmed steps that still hold are kept; everything else needs your approval again.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {newOptions.map((a) => (
              <div
                key={`new-${a.id}`}
                className="db-flash-ok rounded-xl bg-green-100 p-3 text-green-950 ring-2 ring-green-400 dark:bg-green-950/40 dark:text-green-100 dark:ring-green-700"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <Sparkles className="size-5 shrink-0" aria-hidden="true" />
                  New plan: {sampleContactText(plan, a.description)}
                </p>
                <p className="mt-0.5 text-sm md:text-base">Replaces what fell through · needs your OK before anyone is contacted</p>
              </div>
            ))}
            <div className="db-stagger space-y-3">
              {plan.interventions.filter((i) => !newOptions.some((a) => a.id === i.actionId)).map((i) => (
                <p key={i.id} className="flex items-start gap-2">
                  <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />{sampleContactText(plan, i.description)}
                </p>
              ))}
            </div>
            {plan.alternatives.length > 0 && (
              <div>
                <p className="mb-2 font-medium">Or try instead:</p>
                <div className="flex flex-wrap gap-2">
                  {plan.alternatives.map((alt) => (
                    <Button key={alt.activityId} variant="outline" size="lg" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy}
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

      {plan.state === "AWAITING_APPROVAL" && awaiting.length > 0 && (
        <Card className="db-fade-up">
          <CardHeader>
            <CardTitle className="text-xl">Your approval, action by action</CardTitle>
            <CardDescription className="text-sm md:text-base">
              We contact exactly these people, sharing exactly these fields — nothing more.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProgressBar value={approvedCount} total={awaiting.length} label={`${approvedCount} of ${awaiting.length} approved`} />
            {awaiting.map((a) => {
              const approved = a.status === "approved";
              return (
                <div
                  key={`${a.id}-${a.status}`}
                  className={`rounded-xl border p-3 ${approved ? "db-flash-ok border-green-400 bg-green-50 dark:border-green-800 dark:bg-green-950/30" : ""}`}
                >
                  <p className="font-semibold">{contactName(plan, a.scope.recipientId)} — {a.scope.kind === "ride" ? "ask for a ride" : "invite"}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground md:text-base">{sampleContactText(plan, a.description)}</p>
                  <p className="mt-1 text-sm md:text-base">When: {a.scope.when}</p>
                  <p className="mt-1 text-sm md:text-base">
                    Shares: {a.scope.sharedFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={approved ? "default" : "secondary"}>
                      {approved && <Check className="size-3.5" aria-hidden="true" />}
                      {statusWord(a)}
                    </Badge>
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
                <Send aria-hidden="true" />Send requests (simulated)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {plan.dependencies.length > 0 && (
        <Card className="db-fade-up">
          <CardHeader><CardTitle className="text-xl">Confirmations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {liveDeps.length > 0 && (
              <ProgressBar
                value={confirmedCount}
                total={liveDeps.length}
                tone="green"
                label={`${confirmedCount} of ${liveDeps.length} confirmed`}
              />
            )}
            <ul className="space-y-2">
              {plan.dependencies.map((d) => {
                const mark = DEP_MARK[d.status];
                const who = depWho(d);
                const flash = d.status === "confirmed" ? "db-flash-ok" : FAILED_DEP.has(d.status) ? "db-flash-warn" : "";
                const old = !currentIds.has(d.actionId);
                return (
                  <li
                    key={`${d.id}-${d.status}`}
                    className={`flex min-h-11 flex-wrap items-center gap-2 rounded-lg px-2 py-1 ${flash} ${old ? "opacity-70" : ""}`}
                  >
                    {d.status === "requested"
                      ? <span className="flex w-5 justify-center"><PulseDot /></span>
                      : <span className={`w-5 text-center ${mark.cls}`} aria-hidden="true">{mark.mark}</span>}
                    <span className="min-w-0 flex-1">
                      <span className={old ? "line-through" : ""}>{sampleContactText(plan, d.label)}</span>
                      {d.status === "requested" && who && (
                        <span className="block text-sm text-amber-800 dark:text-amber-200">Waiting for {who}…</span>
                      )}
                      {old && <span className="block text-sm text-muted-foreground">Replaced in the new plan</span>}
                    </span>
                    <Badge variant={d.status === "confirmed" ? "default" : d.status === "requested" ? "secondary" : d.status === "not_requested" ? "outline" : "destructive"}>
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
        <Card key="ready" className="db-flash-ok ring-green-300 dark:ring-green-800">
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
        <Card className="db-fade-up">
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
              <div key={p.id} className="db-fade-up rounded-lg border p-3">
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
            {plan.preferencePatches.length === 0 && (
              <p className="text-sm text-muted-foreground md:text-base">
                No change needed — their preferences already cover this.
              </p>
            )}
            {plan.preferencePatches.some((p) => p.status === "applied") && (
              <p className="db-flash-ok rounded-md p-1 text-sm text-muted-foreground md:text-base">Preference updated (profile version {plan.profileVersion}).</p>
            )}
          </CardContent>
        </Card>
      )}

      {plan.state !== "CANCELLED" && plan.state !== "COMPLETED" && current.some((a) => a.providerRequestId) && (
        <Card className="db-fade-up border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="size-5 text-primary" aria-hidden="true" />Demo: simulate replies</CardTitle>
            <CardDescription className="text-sm md:text-base">Stands in for the real texts and confirmations from people and services.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(() => {
              const invite = canSimulate("invite");
              const ride = canSimulate("ride");
              const inviteName = invite ? contactName(plan, invite.scope.recipientId) : "";
              return (
                <>
                  {invite && <>
                    <Button variant="outline" size="lg" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy || !invite} onClick={() => simulate("invite.accepted", invite!.providerRequestId!)}>
                      {inviteName} accepts (simulated)
                    </Button>
                    <Button variant="outline" size="lg" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={busy || !invite} onClick={() => simulate("invite.declined", invite!.providerRequestId!)}>
                      {inviteName} declines (simulated)
                    </Button>
                  </>}
                  <Button variant="outline" size="lg" disabled={busy || !ride} onClick={() => simulate("ride.confirmed", ride!.providerRequestId!)}>
                    Ride confirmed (simulated)
                  </Button>
                  <Button variant="outline" size="lg" disabled={busy || !ride} onClick={() => simulate("ride.cancelled", ride!.providerRequestId!)}>
                    Ride cancelled (simulated)
                  </Button>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {newestFirst.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl"><Clock className="size-5 text-primary" aria-hidden="true" />What happened</CardTitle>
            <CardDescription className="text-sm md:text-base">Every step DayBridge and you took, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm md:text-base">
              {newestFirst.map((e) => {
                const tone = eventTone(e);
                const dotCls = {
                  ok: "bg-green-600 dark:bg-green-500",
                  warn: "bg-destructive",
                  muted: "bg-muted-foreground/40",
                  plain: "bg-primary",
                }[tone];
                const outcome = OUTCOME_WORD[e.outcome];
                return (
                  <li key={e.seq} className={`db-fade-up flex items-start gap-3 ${tone === "muted" ? "text-muted-foreground" : ""}`}>
                    <span className={`mt-1.5 size-2.5 shrink-0 rounded-full md:mt-2 ${dotCls}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={tone === "warn" ? "font-semibold text-destructive" : tone === "ok" ? "font-semibold text-green-800 dark:text-green-300" : "font-medium"}>
                        {eventText(plan, e)}
                      </span>
                      <span className="block text-xs text-muted-foreground md:text-sm">
                        {formatTime(e.at)}{formatTime(e.at) ? " · " : ""}{ACTOR_WORD[e.actor]}
                        {outcome && ` · ${outcome}`}
                        {(e.reason || e.outcome === "rejected") && " — That didn’t go through — try the other option."}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      <footer className="flex flex-wrap gap-2 pb-6 print:hidden">
        {plan.state !== "CANCELLED" && plan.state !== "COMPLETED" && (
          <Button variant="outline" size="lg" disabled={busy} onClick={() => command({ type: "cancel" })}>Cancel plan</Button>
        )}
        <Button variant="ghost" size="lg" disabled={busy} onClick={loadDemo}>
          <RotateCcw className="size-4" aria-hidden="true" />Restart demo
        </Button>
      </footer>
    </main>
  );
}
