"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarPlus, ExternalLink, MapPin } from "lucide-react";
import type { DiscoveryResult, EventCandidate } from "@/lib/integrations/events";
import { eventCalendarLink, eventMapsLink, formatEventTime } from "@/components/discovery/links";
import { FOCUS } from "@/components/shell/focus";
import { publicEventsToShow } from "./discovery-model";

type State = { kind: "loading" | "disabled" | "unavailable" } | { kind: "ready"; data: DiscoveryResult; receivedAt: Date };
const LINK = `inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg font-semibold underline underline-offset-4 ${FOCUS}`;

/** Reuses the existing, opt-in public-event endpoint; no profile or location is sent. */
export function AppDiscovery({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const headingId = compact ? "home-discover-heading" : "discover-public";

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    fetch("/api/integrations/events", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: (DiscoveryResult | { status: "disabled" }) | null) => {
        if (!alive) return;
        if (data?.status === "disabled") setState({ kind: "disabled" });
        else if (data?.status === "live" && Array.isArray(data.events)) setState({ kind: "ready", data, receivedAt: new Date() });
        else setState({ kind: "unavailable" });
      })
      .catch(() => { if (alive) setState({ kind: "unavailable" }); })
      .finally(() => clearTimeout(timeout));
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  const events = state.kind === "ready" ? publicEventsToShow(state.data.events, compact, state.receivedAt) : [];
  const retry = () => { setState({ kind: "loading" }); setAttempt((value) => value + 1); };

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3 border-t pt-6 print:hidden">
      <h2 id={headingId} className="scroll-mt-24 text-[1.75rem] font-semibold leading-tight">
        {compact ? "New this week around Berkeley" : "Discover"}
      </h2>
      <p className="max-w-[70ch] text-base text-foreground/80">
        {compact ? "Upcoming public events in the next seven days, around Berkeley." : "More public events around Berkeley."}
        {" "}These listings are not checked against your answers or added to your week.
      </p>
      <p role="status" aria-live="polite" className="text-base text-muted-foreground">
        {state.kind === "loading" ? "Loading public listings…" : state.kind === "disabled" ? "Public event discovery is off on this server. Your saved week and matches are still available." : state.kind === "unavailable" ? "Public listings couldn't be loaded. Your saved week and matches are still available." : `${events.length} public ${events.length === 1 ? "listing" : "listings"} loaded.`}
      </p>
      {state.kind === "ready" && (
        <>
          <p className="text-base text-muted-foreground">
            From a live public source. This snapshot may use the server&apos;s 5-minute cache.
            {" "}Source checked {state.data.checkedAt ? new Date(state.data.checkedAt).toLocaleString("en-US", {
              timeZone: "America/Los_Angeles", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
            }) : "at an unknown time"}.
          </p>
          {events.length === 0 ? (
            <p role="status" className="text-base text-muted-foreground">{compact ? "No public listings found in the next seven days." : "No upcoming public listings found right now."}</p>
          ) : <PublicListingCards events={events} compact={compact} />}
        </>
      )}
      <button type="button" onClick={() => { if (state.kind !== "loading") retry(); }} aria-disabled={state.kind === "loading"} className={LINK}>
        {state.kind === "loading" ? "Loading public listings…" : "Refresh public listings"}
      </button>
      {compact && <Link href="/matches#discover-public" className={LINK}>See more public listings <span aria-hidden="true">→</span></Link>}
    </section>
  );
}

/** Public candidates deliberately have no saved-week or coordination action. */
export function PublicListingCards({ events, compact }: { events: EventCandidate[]; compact: boolean }) {
  return (
    <ul aria-label="Public event listings" className={`grid gap-4 ${compact ? "xl:grid-cols-3" : "lg:grid-cols-2"}`}>
      {events.map((event) => {
        // Do not turn the shared builder's default duration into a supposed provider fact.
        const calendar = compact || !event.endsAt ? null : eventCalendarLink(event);
        const map = compact ? null : eventMapsLink(event);
        return (
          <li key={event.id} className="min-w-0 space-y-2 rounded-xl border p-4">
            <h3 className="text-xl font-semibold leading-snug break-words">{event.name}</h3>
            <a href={event.url} target="_blank" rel="noopener noreferrer" className={`${LINK} text-primary`} aria-label={`${event.name}: details via UC Berkeley events (opens in new tab)`}>
              <span>Details via UC Berkeley events</span><ExternalLink className="size-4 shrink-0" aria-hidden="true" />
              <span className="sr-only"> (opens in new tab)</span>
            </a>
            <p className="text-base text-foreground/80 break-words">{formatEventTime(event)} · Pacific time</p>
            <p className="text-base text-foreground/80 break-words">{event.location || "Location: Unknown — call ahead"}</p>
            <p className="text-base"><span className="font-medium">Cost, accessibility and eligibility:</span> Unknown — call ahead</p>
            {(calendar || map) && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                {calendar && <a href={calendar} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Add ${event.name} to Google Calendar (opens in new tab)`}>
                  <CalendarPlus className="size-5 shrink-0" aria-hidden="true" /><span>Add to Google Calendar</span>
                </a>}
                {map && <a href={map} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Open ${event.location ?? event.name} in Maps (opens in new tab)`}>
                  <MapPin className="size-5 shrink-0" aria-hidden="true" /><span>Open in Maps</span>
                </a>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
