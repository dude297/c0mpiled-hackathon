"use client";

import { CalendarPlus, Car } from "lucide-react";
import type { VenueInfo } from "@/lib/integrations/places";
import type { PlanItem } from "@/lib/schema";
import { LABELS, planCalendarLink, planRideLinks } from "./links";

const LINK =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-2 px-4 text-base font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground";

// venueByItem is only present when the server ran optional enrichment (DAYBRIDGE_ENRICH=1).
export function HandoffLinks({ item, result }: { item: PlanItem; result: unknown }) {
  const venue = (result as { venueByItem?: Record<string, VenueInfo | null> } | null)?.venueByItem?.[item.activityId];
  const cal = planCalendarLink(item, venue);
  const rides = planRideLinks(venue);
  if (!cal && !rides) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 print:hidden">
      {cal && (
        <a href={cal} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Add ${item.name} to Google Calendar (${LABELS.approx}, opens in new tab)`}>
          <CalendarPlus className="size-5" aria-hidden="true" />
          Add to calendar <span className="text-sm font-normal text-muted-foreground">({LABELS.approx})</span>
        </a>
      )}
      {rides && (
        <>
          <a href={rides.uberLink} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Uber to ${venue!.name}. ${LABELS.ride}`}>
            <Car className="size-5" aria-hidden="true" />Uber
          </a>
          <a href={rides.lyftLink} target="_blank" rel="noopener noreferrer" className={LINK} aria-label={`Lyft to ${venue!.name}. ${LABELS.ride}`}>
            <Car className="size-5" aria-hidden="true" />Lyft
          </a>
          <p className="w-full text-sm text-muted-foreground">{LABELS.ride}</p>
        </>
      )}
    </div>
  );
}
