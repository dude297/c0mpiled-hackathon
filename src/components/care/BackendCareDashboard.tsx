"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FOCUS } from "@/components/shell/focus";
import { PlanStatusLabel } from "@/components/shell/PlanStatusLabel";
import { planStatusView } from "@/components/shell/helpers";
import type { CheckInInput } from "@/domain/caregiver/contract";
import { CareApiError, CheckInDraft, canUseDeviceFallback, careErrorMessage, createCareApi, dependencyStatus, isAccessError, readableDate, type CareLabels, type History, type Overview, type PersonDetail } from "./care-api";
import type { z } from "zod";

const IDENTITY_KEY = "daybridge:care:demo-identity";
const IDENTITIES = [{ id: "cg-dana", label: "Dana — caregiver demo" }, { id: "cg-lee", label: "Lee — view-only demo" }, { id: "self-maya", label: "Maya — self demo" }];
const H1 = "text-[2.25rem] font-semibold leading-tight";
const H2 = "text-[1.375rem] font-semibold leading-tight";
const LINK = `inline-flex min-h-11 items-center rounded-md underline underline-offset-4 ${FOCUS}`;
const PANEL = "space-y-4 rounded-2xl border border-border p-4 sm:p-6";
type Api = ReturnType<typeof createCareApi>;

function Loading() { return <div className="space-y-4"><h1 className={H1}>Caregiver view</h1><p role="status">Loading caregiver information…</p></div>; }

export function BackendCareDashboard({ personId, fallback }: { personId?: string; fallback: ReactNode }) {
  const [identity, setIdentity] = useState<string | null>(null);
  useEffect(() => {
    let saved = "cg-dana";
    try { const value = localStorage.getItem(IDENTITY_KEY); if (IDENTITIES.some((i) => i.id === value)) saved = value!; } catch { /* Storage is optional. */ }
    const timer = setTimeout(() => setIdentity(saved), 0);
    return () => clearTimeout(timer);
  }, []);
  function choose(value: string) {
    try { localStorage.setItem(IDENTITY_KEY, value); } catch { /* The selection still works for this visit. */ }
    setIdentity(value);
  }
  if (identity === null) return <Loading />;
  return (
    <div className="max-w-[58rem] space-y-6 text-base">
      <div className={PANEL}>
        <label htmlFor="care-demo-identity" className="block font-semibold">Demo identity (not sign-in)</label>
        <select id="care-demo-identity" value={identity} onChange={(event) => choose(event.target.value)} className={`min-h-11 w-full rounded-lg border border-border bg-background px-3 sm:max-w-sm ${FOCUS}`}>
          {IDENTITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <p className="text-muted-foreground">Local demo caller only. This does not verify identity or link accounts. Access is limited by the server&apos;s sharing grants.</p>
      </div>
      <CareContent key={`${identity}:${personId ?? "overview"}`} identity={identity} personId={personId} fallback={fallback} />
    </div>
  );
}

function StorageLabels({ labels }: { labels: CareLabels }) {
  return <aside className="space-y-2 rounded-xl bg-muted p-4" aria-label="Demo limitations">
    <p>{labels.storage === "memory" ? "Demo storage: data resets when the server restarts." : "Saved to server storage."}</p>
    <p>Simulated providers: no real ride or invite was sent.</p>
  </aside>;
}

function Unavailable({ error, fallback, retry }: { error: unknown; fallback: ReactNode; retry: () => void }) {
  return <div className="space-y-6">
    <aside className={PANEL}>
      <p role="alert">{careErrorMessage(error)}</p>
      <p>The independent same-device demo below uses only this browser&apos;s saved person and plans. It does not show caregiver server records.</p>
      <Button size="lg" variant="outline" onClick={retry}>Retry caregiver connection</Button>
    </aside>
    {fallback}
  </div>;
}

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return <section className="space-y-4">
    <h1 className={H1}>Caregiver view</h1>
    <p role="alert">{careErrorMessage(error)}</p>
    {error instanceof CareApiError && error.status === 401 && <p>Use the demo identity picker above.</p>}
    <div className="flex flex-wrap items-center gap-4"><Button size="lg" variant="outline" onClick={retry}>Retry</Button><Link className={LINK} href="/care">Back to people</Link></div>
  </section>;
}

function CareContent({ identity, personId, fallback }: { identity: string; personId?: string; fallback: ReactNode }) {
  const api = useMemo(() => createCareApi(identity), [identity]);
  return personId ? <PersonView api={api} identity={identity} personId={personId} fallback={fallback} /> : identity === "self-maya" ? <SelfDemoView api={api} fallback={fallback} /> : <PeopleView api={api} fallback={fallback} />;
}

/** This fixed id belongs only to the documented fictional fixture; self gets no caregiver reads. */
function SelfDemoView({ api, fallback }: { api: Api; fallback: ReactNode }) {
  const personId = "7d1f0a52-4c1e-4b8a-9a0e-6d6179610001";
  const [profile, setProfile] = useState<Awaited<ReturnType<Api["profile"]>> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api.profile(personId, controller.signal).then((value) => { if (!controller.signal.aborted) { setProfile(value); setError(null); } }).catch((failure) => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [api, version]);
  const reload = () => setVersion((value) => value + 1);
  if (!profile && !error) return <Loading />;
  if (error) return canUseDeviceFallback(error) ? <Unavailable error={error} fallback={fallback} retry={reload} /> : <LoadError error={error} retry={reload} />;
  if (!profile) return null;
  return <div className="space-y-6"><h1 className={H1}>{profile.profile.name}&apos;s check-in</h1><p>This self demo can record a check-in and read its own profile. Caregiver plans and history require an explicit sharing grant.</p><CheckInForm api={api} personId={personId} self onSaved={() => {}} /><StorageLabels labels={profile.labels} /></div>;
}

function PeopleView({ api, fallback }: { api: Api; fallback: ReactNode }) {
  const [data, setData] = useState<z.infer<typeof Overview> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api.overview(controller.signal).then((value) => { if (!controller.signal.aborted) { setData(value); setError(null); } }).catch((failure) => {
      if (!controller.signal.aborted) { setError(failure); if (isAccessError(failure)) setData(null); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [api, version]);
  const reload = () => { setBusy(true); setVersion((value) => value + 1); };
  async function seed() {
    setBusy(true); setNotice("");
    try { await api.seedDemo(); setNotice("Fictional demo people loaded. The demo records were reset."); reload(); }
    catch (failure) { setError(failure); setBusy(false); }
  }
  if (!data && !error) return <Loading />;
  if (!data && error) return canUseDeviceFallback(error) ? <Unavailable error={error} fallback={fallback} retry={reload} /> : <LoadError error={error} retry={reload} />;
  if (!data) return null;
  return <div className="space-y-8" aria-busy={busy}>
    <header className="space-y-3"><h1 className={H1}>People you support</h1><p>See shared plans and check-ins. Only the person can say OK to their arrangements.</p><Button size="lg" variant="outline" disabled={busy} onClick={reload}>{busy ? "Refreshing…" : "Refresh"}</Button></header>
    <p role="status" aria-live="polite">{notice}</p>
    {error !== null && <p role="alert">{careErrorMessage(error)} These records may be out of date.</p>}
    {data.people.length === 0 ? <section className={PANEL}><p>No one shared with you yet.</p><p>To explore the local demo, load fictional Maya and Margaret records. This resets only those demo records on this server.</p><Button size="lg" disabled={busy} onClick={() => void seed()}>Load fictional caregiver demo</Button></section> : <ul className="grid gap-4 sm:grid-cols-2">
      {data.people.map((person) => <li key={person.personId} className={PANEL}>
        <h2 className={H2}><Link className={LINK} href={`/care/${encodeURIComponent(person.personId)}`}>{person.displayName}</Link></h2>
        <p className="flex items-center gap-2"><CircleAlert className="size-5 shrink-0" aria-hidden="true" />{person.attentionCount} {person.attentionCount === 1 ? "item needs" : "items need"} attention</p>
        {person.nextActivity ? <div className="space-y-2"><p className="font-semibold">{person.nextActivity.activityName}</p><p>{person.nextActivity.slot}</p><DateText at={person.nextActivity.nextDate} timezone={person.timezone} dateOnly /><PlanStatusLabel view={planStatusView(person.nextActivity.state, "caregiver", person.displayName)} /></div> : <p>No upcoming activity</p>}
        {person.latestCheckIn ? <div><p>{checkInText(person.latestCheckIn.kind)} · {person.latestCheckIn.reporterRole === "self" ? "Self" : "Caregiver"}</p><DateText at={person.latestCheckIn.at} timezone={person.timezone} /></div> : <p>No check-ins yet</p>}
        <p className="text-muted-foreground">Access: {person.myScopes.map(scopeName).join(", ")}</p>
      </li>)}
    </ul>}
    <StorageLabels labels={data.labels} />
  </div>;
}

function scopeName(value: string) { return ({ view: "view", checkin: "record check-ins", manage: "manage" } as Record<string, string>)[value] ?? "Unknown"; }
function checkInText(kind: string) { return ({ ok: "OK", call: "Please call", help: "Need help" } as Record<string, string>)[kind] ?? "Unknown"; }
function DateText({ at, timezone, dateOnly = false }: { at: string; timezone: string; dateOnly?: boolean }) {
  const text = readableDate(at, timezone, dateOnly);
  return <p><time dateTime={at} aria-label={`${text}, ${timezone}`}>{text}</time><span className="text-muted-foreground"> · {timezone}</span></p>;
}

function PersonView({ api, identity, personId, fallback }: { api: Api; identity: string; personId: string; fallback: ReactNode }) {
  const [data, setData] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api.person(personId, controller.signal).then((value) => { if (!controller.signal.aborted) { setData(value); setError(null); } }).catch((failure) => {
      if (!controller.signal.aborted) { setError(failure); if (isAccessError(failure)) setData(null); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [api, personId, version]);
  const reload = () => { setBusy(true); setVersion((value) => value + 1); };
  async function acknowledge(itemId: string) {
    setAckBusy(itemId); setActionError(""); setNotice("");
    try {
      await api.acknowledge(itemId);
      setData((current) => current ? { ...current, attention: current.attention.map((item) => item.itemId === itemId ? { ...item, acknowledgedByMe: true } : item) } : current);
      setNotice("Acknowledged by you. This records that you've seen it; the item stays until the underlying situation changes.");
    } catch (failure) {
      if (failure instanceof CareApiError && failure.status === 404) { setActionError("This item is no longer current."); reload(); }
      else { setActionError(careErrorMessage(failure)); if (failure instanceof CareApiError && failure.status === 403) reload(); }
    } finally { setAckBusy(null); }
  }
  if (!data && !error) return <Loading />;
  if (!data && error) return canUseDeviceFallback(error) ? <Unavailable error={error} fallback={fallback} retry={reload} /> : <LoadError error={error} retry={reload} />;
  if (!data) return null;
  const { person } = data;
  const self = person.selfUserId === identity;
  const canCheckIn = self || data.myScopes.includes("checkin");
  return <div className="space-y-8" aria-busy={busy}>
    <header className="space-y-3"><Link href="/care" className={LINK}>Back to people</Link><h1 className={H1}>{person.profile.name}&apos;s shared plans</h1><p>Access: {data.myScopes.map(scopeName).join(", ")}. Only {person.profile.name} can say OK to arrangements.</p><Button size="lg" variant="outline" disabled={busy} onClick={reload}>{busy ? "Refreshing…" : "Refresh"}</Button></header>
    {error !== null && <p role="alert">{careErrorMessage(error)} These records may be out of date.</p>}
    <section aria-labelledby="care-attention" className={PANEL}>
      <h2 id="care-attention" className={H2}>Needs attention</h2>
      <p role="status" aria-live="polite">{notice}</p>{actionError && <p role="alert">{actionError}</p>}
      {data.attention.length === 0 ? <p>No attention items recorded.</p> : <ul className="space-y-4">{[...data.attention].sort((a, b) => (a.kind === "help_requested" ? -1 : b.kind === "help_requested" ? 1 : 0)).map((item) => <li key={item.itemId} className="space-y-2 border-l-4 border-amber-600 pl-4 dark:border-amber-400">
        <p className="flex items-center gap-2 font-semibold"><CircleAlert className="size-5 shrink-0" aria-hidden="true" />{item.title}</p><p>{item.detail}</p><DateText at={item.createdAt} timezone={person.timezone} />
        {item.kind === "approval_needed" && <p>Review the original plan together in the coordination screen. This dashboard cannot approve on {person.profile.name}&apos;s behalf.</p>}
        {item.acknowledgedByMe ? <p className="font-semibold">Acknowledged by you</p> : data.myScopes.includes("view") && <Button size="lg" variant="outline" disabled={ackBusy !== null || busy} onClick={() => void acknowledge(item.itemId)}>{ackBusy === item.itemId ? "Saving…" : "Acknowledge"}</Button>}
      </li>)}</ul>}
      <p className="text-muted-foreground">Acknowledging means “I&apos;ve seen this.” It does not resolve a request, contact anyone, or change a plan.</p>
    </section>
    <section aria-labelledby="care-upcoming" className={PANEL}><h2 id="care-upcoming" className={H2}>Upcoming</h2>{data.upcoming.length === 0 ? <p>No upcoming activity</p> : <ul className="space-y-4">{data.upcoming.map((item) => <li key={item.planId} className="space-y-2"><p className="font-semibold">{item.activityName}</p><p>{item.slot}</p><DateText at={item.nextDate} timezone={item.timezone} dateOnly /><PlanStatusLabel view={planStatusView(item.state, "caregiver", person.profile.name)} /></li>)}</ul>}</section>
    <section aria-labelledby="care-plans" className={PANEL}>
      <h2 id="care-plans" className={H2}>Plans</h2>
      {data.plans.length === 0 ? <p>No shared plans yet.</p> : <ul className="divide-y divide-border">{data.plans.map((plan) => <li key={plan.planId} className="space-y-3 py-4"><h3 className="text-lg font-semibold">{plan.activityName}</h3><p>{plan.when}</p><PlanStatusLabel view={planStatusView(plan.state, "caregiver", person.profile.name)} />
        {plan.dependencies.length > 0 && <ul className="space-y-2">{plan.dependencies.map((dependency, index) => <li key={index}><p className="flex items-start gap-2">{dependency.status === "confirmed" ? <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> : <Clock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}<span>{dependency.label}: {dependencyStatus(dependency.status)}</span></p><p className="text-muted-foreground">Simulated: no real ride or invite was sent.</p></li>)}</ul>}
        {plan.outcome && <p className="font-semibold">{plan.outcome.attended ? "Attended" : "Did not attend"} (self-reported)</p>}
      </li>)}</ul>}
    </section>
    <section aria-labelledby="care-checkins" className={PANEL}>
      <h2 id="care-checkins" className={H2}>Recent check-ins</h2>
      <p>{person.checkInSchedule ? `Check-in schedule: every ${person.checkInSchedule.everyDays} ${person.checkInSchedule.everyDays === 1 ? "day" : "days"}.` : "No check-in schedule set."}</p>
      {data.latestCheckIns.length === 0 ? <p>No check-ins yet</p> : <ul className="space-y-4">{data.latestCheckIns.map((item) => <li key={item.checkInId} className="space-y-1"><p className="font-semibold">{checkInText(item.kind)} · {item.reporterRole === "self" ? "Self" : "Caregiver"}</p><DateText at={item.at} timezone={person.timezone} /><Note item={item} /></li>)}</ul>}
      {canCheckIn ? <CheckInForm api={api} personId={personId} self={self} onSaved={reload} /> : <p className="text-muted-foreground">View-only access. Ask a manager for permission to record check-ins.</p>}
    </section>
    <HistoryView key={`${personId}:${version}`} api={api} personId={personId} timezone={person.timezone} />
    <StorageLabels labels={data.labels} />
  </div>;
}

function Note({ item }: { item: { note?: string; hasNote?: true } }) {
  return item.note ? <p className="whitespace-pre-wrap break-words">{item.note}</p> : item.hasNote ? <p className="text-muted-foreground">Note (visible to the reporter and managers)</p> : null;
}

export function CheckInForm({ api, personId, self, onSaved }: { api: Api; personId: string; self: boolean; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sending = useRef(false);
  const draft = useRef(new CheckInDraft());
  async function send(kind: CheckInInput["kind"]) {
    if (sending.current || note.trim().length > 280) return;
    sending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const saved = await api.checkIn(personId, draft.current.submission(kind, note));
      setNotice(saved.duplicate ? "Already saved." : "Check-in saved."); setNote(""); draft.current.saved(); onSaved();
    } catch (failure) {
      setError(failure instanceof CareApiError && failure.status === 409 ? "That check-in was already sent with different details. Reload and try again." : careErrorMessage(failure));
    } finally { sending.current = false; setBusy(false); }
  }
  return <div className="space-y-3 border-t border-border pt-5" aria-busy={busy}>
    <h3 className="text-lg font-semibold">Record a check-in</h3>
    <label htmlFor="care-checkin-note" className="block">Optional note</label>
    <Textarea id="care-checkin-note" value={note} disabled={busy} maxLength={280} aria-describedby="care-note-count care-checkin-help" className="min-h-24 text-base md:text-base" onChange={(event) => setNote(event.target.value)} />
    <p id="care-note-count">{note.length}/280 characters</p>
    <div className="flex flex-wrap gap-3">{([{ kind: "ok", label: self ? "I'm OK" : "They're OK" }, { kind: "call", label: "Please call" }, { kind: "help", label: "Need help" }] as const).map((item) => <Button key={item.kind} size="xl" variant={item.kind === "ok" ? "default" : "outline"} disabled={busy} onClick={() => void send(item.kind)}>{busy ? "Saving…" : item.label}</Button>)}</div>
    <p id="care-checkin-help" className="text-muted-foreground">This records a check-in. It doesn&apos;t contact anyone or change any plan. For urgent help, contact someone directly.</p>
    <p role="status" aria-live="polite">{notice}</p>{error && <p role="alert">{error}</p>}
  </div>;
}

function HistoryView({ api, personId, timezone }: { api: Api; personId: string; timezone: string }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [version, setVersion] = useState(0);
  const firstAdded = useRef<HTMLLIElement | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [loadedMessage, setLoadedMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api.history(personId, undefined, controller.signal).then((value) => { if (!controller.signal.aborted) { setData(value); setError(""); } }).catch((failure) => { if (!controller.signal.aborted) { setError(careErrorMessage(failure)); if (isAccessError(failure)) setData(null); } }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [api, personId, version]);
  useEffect(() => { firstAdded.current?.focus(); }, [focusIndex]);
  async function more() {
    if (!data?.nextCursor || busy) return;
    setBusy(true); setError("");
    try {
      const page = await api.history(personId, data.nextCursor);
      setFocusIndex(data.items.length); setData({ ...page, items: [...data.items, ...page.items] });
      setLoadedMessage(`${page.items.length} more history ${page.items.length === 1 ? "item" : "items"} loaded.`);
    } catch (failure) { setError(careErrorMessage(failure)); if (isAccessError(failure)) setData(null); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="care-history" className={PANEL} aria-busy={busy}>
    <h2 id="care-history" className={H2}>History</h2>
    {error && <div className="space-y-3"><p role="alert">{error}{data ? " History may be out of date." : ""}</p><Button size="lg" variant="outline" disabled={busy} onClick={() => { setBusy(true); setVersion((value) => value + 1); }}>Retry history</Button></div>}
    <p role="status" aria-live="polite">{busy ? "Loading history…" : loadedMessage}</p>
    {data?.items.length === 0 && <p>No history recorded yet.</p>}
    {data && <ol className="space-y-4">{data.items.map((item, index) => <li key={`${item.at}:${item.type}:${index}`} tabIndex={-1} ref={focusIndex === index ? firstAdded : undefined} className={`space-y-1 rounded-md ${FOCUS}`}>
      <p className="font-semibold">{item.type === "checkin" ? "Check-in" : item.type === "dependency" ? "Ride or invite" : item.type === "plan_state" ? "Plan" : item.type === "attendance" ? "Attendance" : "Feedback"}</p><p>{item.summary}</p><DateText at={item.at} timezone={timezone} />{item.checkIn && <><p>{item.checkIn.reporterRole === "self" ? "Self" : "Caregiver"}</p><Note item={item.checkIn} /></>}
    </li>)}</ol>}
    {data?.nextCursor && <Button size="lg" variant="outline" disabled={busy} onClick={() => void more()}>Load more history</Button>}
  </section>;
}
