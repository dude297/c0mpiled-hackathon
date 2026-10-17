"use client";

// U3 Matches (docs/product/SCREENS.md). Cards not in the week first; "didn't fit" collapsed with plain reasons.
import { useState } from "react";
import Link from "next/link";
import { Check, CircleX } from "lucide-react";
import { FOCUS } from "@/components/shell/focus";
import { ProfileGate } from "@/components/shell/ProfileGate";
import { coordinateHref, personName, useDeviceStore, usePlanStatus } from "@/components/shell/store";
import type { AnalysisResult, PlanItem } from "@/lib/schema";
import { AnalyzeLine, HeadsUpRow, QUIET_LINK, SampleNote } from "./bits";
import { cardHeadsUp, didntFitLabel, didntFitReason, metaLine, sortMatches } from "./format";
import { writeProfileHandoff } from "@/components/home/handoff";

export function MatchesView() {
  return (
    <div className="space-y-6">
      <h1 className="text-[2.25rem] font-semibold leading-tight">Good matches for you</h1>
      <ProfileGate>
        <Matches />
      </ProfileGate>
    </div>
  );
}

function Matches() {
  const store = useDeviceStore();
  const { result, week, toggleWeek, profile } = store;
  const person = personName(store);
  const ps = usePlanStatus();
  // Order is fixed per result so a card doesn't jump away when it's added.
  const [order, setOrder] = useState<{ result: AnalysisResult | null; ids: string[] }>({ result: null, ids: [] });
  if (result && order.result !== result) setOrder({ result, ids: sortMatches(result.plan, week).map((i) => i.activityId) });

  if (!result) return <AnalyzeLine />;

  const byId = new Map(result.plan.map((i) => [i.activityId, i]));
  const items = (order.result === result ? order.ids : result.plan.map((i) => i.activityId)).flatMap((id) => byId.get(id) ?? []);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <SampleNote />
        <AnalyzeLine />
      </div>

      {items.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xl font-semibold">Nothing fit this week.</p>
          <Link href="/profile" className={QUIET_LINK}>Change my answers</Link>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="Matches">
          {items.map((item) => {
            const view = ps.viewFor(item.activityId);
            // 503: coordination is off on this server, so no dead "Get me there" link.
            const action = ps.unavailable ? null : view.action;
            const planId = view.resume && !ps.unavailable ? ps.statusFor(item.activityId).planId : null;
            return (
              <MatchCard
                key={item.activityId}
                item={item}
                added={week.includes(item.activityId)}
                onToggle={() => toggleWeek(item.activityId)}
                action={action}
                actionHref={coordinateHref(item.activityId, planId)}
                onGo={() => writeProfileHandoff(profile)}
              />
            );
          })}
        </ul>
      )}

      {result.blocked.length > 0 && (
        <details className="group border-t pt-4">
          <summary className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg text-lg font-medium ${FOCUS}`}>
            {didntFitLabel(result.blocked.length)}
          </summary>
          <ul className="mt-3 divide-y">
            {result.blocked.map((b) => (
              <li key={b.name} className="flex flex-col gap-1 py-3 md:flex-row md:items-baseline md:justify-between md:gap-4">
                <div>
                  <p className="font-semibold">{b.name}</p>
                  <p className="flex items-start gap-2 text-foreground/85">
                    <CircleX className="mt-1 size-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>
                      <span className="font-medium">Didn&apos;t fit: </span>
                      {didntFitReason(b.barriers, person)}
                    </span>
                  </p>
                </div>
                <Link href="/profile" className={`${QUIET_LINK} shrink-0 text-base`}>What would change this</Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function MatchCard({ item, added, onToggle, action, actionHref, onGo }: {
  item: PlanItem;
  added: boolean;
  onToggle: () => void;
  action: string | null;
  actionHref: string;
  /** Writes the X1 profile handoff (sessionStorage) before leaving for /coordinate. */
  onGo: () => void;
}) {
  const { first, more } = cardHeadsUp(item);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border p-5">
      <h2 className="text-[1.375rem] font-semibold leading-snug">
        <Link href={`/activity/${encodeURIComponent(item.activityId)}?from=matches`} className={`rounded hover:underline ${FOCUS}`}>
          {item.name}
        </Link>
      </h2>
      <p className="text-foreground/80">{metaLine(item)}</p>
      {first && <HeadsUpRow barrier={first} />}
      {more > 0 && (
        <Link href={`/activity/${encodeURIComponent(item.activityId)}?from=matches`} className={`${QUIET_LINK} text-base`}>
          +{more} more to know
        </Link>
      )}
      <div className="mt-auto flex flex-col gap-2 pt-1">
        <button
          type="button"
          aria-pressed={added}
          onClick={onToggle}
          className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-6 text-lg font-semibold ${FOCUS} ${
            added ? "border-2 border-primary text-primary hover:bg-primary/5" : "bg-primary text-primary-foreground hover:bg-primary/85"
          }`}
        >
          {added && <Check className="size-5" aria-hidden="true" />}
          {added ? "In my week" : "Add to my week"}
        </button>
        {action && (
          <Link href={actionHref} onClick={onGo} onAuxClick={onGo} className={`${QUIET_LINK} justify-center print:hidden`}>
            {action} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </li>
  );
}
