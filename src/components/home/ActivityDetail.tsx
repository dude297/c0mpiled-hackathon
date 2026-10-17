"use client";

// U5 Activity detail (docs/product/SCREENS.md "U5"). Data: the stored result's PlanItem + ACTIVITIES (read-only) + plan status.
// Must render inside <Suspense>: it reads the URL (useParams / useSearchParams) and cacheComponents is on.
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { PlanStatusLabel } from "@/components/shell/PlanStatusLabel";
import { ProfileGate } from "@/components/shell/ProfileGate";
import { coordinateHref, personLabel, personName, useDeviceStore, usePlanStatus } from "@/components/shell/store";
import { whenText } from "@/components/views/copy";
import { ACTIVITIES } from "@/domain/activities";
import { writeProfileHandoff } from "./handoff";
import {
  accessFacts, activityPrimaryLabel, backLink, checksFor, costWords, didntFitReason, otherWays, softBarrierText, travelLine, travelMode,
} from "./home-model";
import { Disclosure, GoLink, HeadsUpRow, PRIMARY, QUIET_LINK, SECONDARY } from "./ui";

const H2 = "text-[1.75rem] font-semibold leading-tight";

export function ActivityDetail() {
  const params = useParams<{ id: string }>();
  const from = useSearchParams().get("from");
  let id = typeof params.id === "string" ? params.id : "";
  try {
    id = decodeURIComponent(id);
  } catch {
    // keep the raw id; it simply won't match
  }
  return (
    <ProfileGate>
      <Detail id={id} from={from} />
    </ProfileGate>
  );
}

function Detail({ id, from }: { id: string; from: string | null }) {
  const s = useDeviceStore();
  const ps = usePlanStatus();
  const back = backLink(from, s.mode);
  const activity = ACTIVITIES.find((a) => a.id === id);

  if (!activity) {
    return (
      <section className="max-w-[65ch] space-y-3">
        <h1 className="text-[2.25rem] font-semibold leading-tight">We couldn&apos;t find that activity</h1>
        <Link href="/matches" className={QUIET_LINK}>Back to matches</Link>
      </section>
    );
  }

  const name = personLabel(s);
  const person = personName(s);
  const caregiver = s.mode === "caregiver";
  const item = s.result?.plan.find((i) => i.activityId === id) ?? null;
  const inWeek = s.week.includes(id);
  const when = whenText(item?.when ?? `${activity.day} ${activity.time}`);
  const mode = item ? travelMode(item.travel) : null;
  const others = otherWays(activity, mode, s.profile?.mobility ?? null);
  const soft = item?.barriers.filter((b) => b.severity === "soft") ?? [];
  const passed = checksFor(s.result, activity.name, person).filter((c) => c.passed);
  const reason = item ? null : didntFitReason(s.result, activity.name, person);

  const view = ps.viewFor(id);
  const status = ps.statusFor(id);
  const primaryLabel = item && !ps.unavailable ? activityPrimaryLabel(view, s.mode, name) : null;
  const primaryHref = coordinateHref(id, view.resume ? status.planId : null);
  const showToggle = !!item && !caregiver;

  return (
    <div className="space-y-8">
      <Link href={back.href} className={`${QUIET_LINK} print:hidden`}>
        <span aria-hidden="true">←&nbsp;</span>
        {back.label}
      </Link>

      <header className="space-y-2">
        <h1 className="text-[2.25rem] font-semibold leading-tight break-words">{activity.name}</h1>
        <p className="text-xl">
          {when} · {costWords(item?.costPerWeek ?? activity.costPerWeek)}
        </p>
        {item && !ps.unavailable && <PlanStatusLabel view={view} className="text-lg" />}
        {!item && (
          <p className="text-lg">
            Not in your matches.{reason ? ` ${reason}.` : ""}
          </p>
        )}
      </header>

      <section aria-labelledby="getting-heading" className="max-w-[65ch] space-y-2">
        <h2 id="getting-heading" className={H2}>Getting there</h2>
        {item && <p className="text-xl">{travelLine(item.travel)}</p>}
        {others.length > 0 && (
          <p className="text-lg">
            {item ? "Other ways" : "Ways to get there"}: {others.join(" · ")}
          </p>
        )}
        <p className="text-lg">{accessFacts(activity).join(" · ")}</p>
        <p className="text-[1rem] text-muted-foreground">Travel times and access are our estimates, not confirmed by the venue.</p>
      </section>

      {item && (
        <section aria-labelledby="way-heading" className="max-w-[65ch] space-y-3">
          <h2 id="way-heading" className={H2}>What could get in the way</h2>
          {soft.length ? (
            <ul className="space-y-4">
              {soft.map((b) => {
                const { detail, tip } = softBarrierText(b, person);
                return (
                  <HeadsUpRow key={b.rule}>
                    <p className="text-lg">{detail}</p>
                    {tip && <p className="text-lg text-foreground/80">What helps: {tip}</p>}
                  </HeadsUpRow>
                );
              })}
            </ul>
          ) : (
            <p className="text-lg">Nothing we know of.</p>
          )}
        </section>
      )}

      {passed.length > 0 && (
        <Disclosure summary="How we checked">
          <ul className="list-disc space-y-1 pl-5 text-lg">
            {passed.map((c) => (
              <li key={c.text}>{c.text}</li>
            ))}
          </ul>
        </Disclosure>
      )}

      {(showToggle || primaryLabel || (item && ps.unavailable)) && (
        // Sticky on phones so the primary stays under the thumb; plain row from 768px up.
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-background px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center md:static md:mx-0 md:border-0 md:px-0 md:py-0 print:hidden">
          {primaryLabel && (
            <GoLink href={primaryHref} coordinate onGo={() => writeProfileHandoff(s.profile)} className={PRIMARY}>
              {primaryLabel}
            </GoLink>
          )}
          {item && ps.unavailable && <p className="text-lg">Get me there isn&apos;t available on this server.</p>}
          {showToggle && (
            <button type="button" aria-pressed={inWeek} onClick={() => s.toggleWeek(id)} className={`${SECONDARY} min-h-14 w-full sm:w-auto`}>
              {inWeek && <Check className="size-5 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />}
              {inWeek ? "In my week" : "Add to my week"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
