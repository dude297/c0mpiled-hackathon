"use client";

import { useEffect, useState } from "react";
import { CalendarPlus, ExternalLink, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { DiscoveryResult } from "@/lib/integrations/events";
import { LABELS, eventCalendarLink, eventMapsLink, formatEventTime, relativeTime } from "./links";

const LINK =
  "inline-flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 text-base font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

type State = { kind: "loading" } | { kind: "off" } | { kind: "live"; data: DiscoveryResult };

export function DiscoveryFeed() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch("/api/integrations/events", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DiscoveryResult | null) => {
        if (!alive) return;
        setState(d?.status === "live" && Array.isArray(d.events) ? { kind: "live", data: d } : { kind: "off" });
      })
      .catch(() => alive && setState({ kind: "off" }));
    return () => { alive = false; };
  }, []);

  return (
    <section aria-labelledby="discover-heading" className="space-y-3 border-t-2 pt-6 print:hidden">
      <h2 id="discover-heading" className="text-2xl font-semibold">Discover nearby</h2>
      <p className="text-muted-foreground">Public listings from outside sources. These are not part of your plan and were not checked for fit.</p>
      {state.kind === "loading" && (
        <ul aria-busy="true" aria-label="Loading public events" className="grid gap-3">
          {[0, 1, 2].map((i) => <li key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}
        </ul>
      )}
      {(state.kind === "off" || (state.kind === "live" && state.data.events.length === 0)) && (
        <p role="status" className="text-sm text-muted-foreground">{state.kind === "off" ? LABELS.eventsOff : "No upcoming public events found right now."}</p>
      )}
      {state.kind === "live" && state.data.events.length > 0 && (
        <ul className="grid gap-3">
          {state.data.events.slice(0, 8).map((e) => {
            const cal = eventCalendarLink(e);
            const map = eventMapsLink(e);
            return (
              <li key={e.id} className="rounded-xl border bg-card p-4">
                <h3 className="text-lg font-semibold leading-snug">{e.name}</h3>
                <p className="mt-1 text-foreground/80">{formatEventTime(e)}{e.location ? ` · ${e.location}` : ""}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline" className="h-auto whitespace-normal">{LABELS.publicEvent}</Badge>
                  <Badge variant="outline" className="h-auto whitespace-normal">{LABELS.accessibility}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Source: <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">UC Berkeley events<ExternalLink className="ml-1 inline size-3" aria-hidden="true" /><span className="sr-only"> (opens in new tab)</span></a>
                  {" · "}checked {relativeTime(e.checkedAt)}
                </p>
                {(cal || map) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cal && (
                      <a href={cal} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Add ${e.name} to Google Calendar (opens in new tab)`}>
                        <CalendarPlus className="size-5" aria-hidden="true" />Add to Google Calendar
                      </a>
                    )}
                    {map && (
                      <a href={map} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Open ${e.location ?? e.name} in Maps (opens in new tab)`}>
                        <MapPin className="size-5" aria-hidden="true" />Open in Maps
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
