"use client";

// C1 Caregiver dashboard (docs/product/SCREENS.md "C1", journeys/caregiver.md). Reads the device store + plan status.
// Caregivers never approve on the person's behalf (GOALS Open): rows only link to X1, where the person decides.
import Link from "next/link";
import { FOCUS } from "@/components/shell/focus";
import { PlanStatusLabel } from "@/components/shell/PlanStatusLabel";
import { personLabel, useDeviceStore, usePlanStatus } from "@/components/shell/store";
import { writeProfileHandoff } from "@/components/home/handoff";
import { buildCareModel, possessive, type CareModel } from "./care-model";
import { BackendCareDashboard } from "./BackendCareDashboard";

const PRIMARY = `inline-flex min-h-14 items-center rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground hover:bg-primary/85 ${FOCUS}`;
const LINK = `inline-flex min-h-11 items-center rounded-md underline underline-offset-4 hover:text-foreground ${FOCUS}`;
const H2 = "text-[1.375rem] font-semibold leading-tight";
const META = "text-base text-muted-foreground";

export function CareDashboard({ personId }: { personId?: string }) {
  return <BackendCareDashboard personId={personId} fallback={<LocalCareDashboard />} />;
}

/** The existing browser-only demo remains available when the caregiver API is unavailable. */
function LocalCareDashboard() {
  const store = useDeviceStore();
  const ps = usePlanStatus();
  if (!store.ready) return <p role="status">Loading saved answers…</p>;

  const name = personLabel(store);
  if (!store.profile) return <SetUp name={name} />;

  const model = buildCareModel({
    name,
    week: store.week,
    plans: store.plans,
    result: store.result,
    statusFor: ps.statusFor,
    unavailable: ps.unavailable,
  });

  return (
    <CareView
      model={model}
      unavailable={ps.unavailable}
      analyzing={store.analyzing && !store.result}
      error={store.error}
      onPrimary={model.primary.toUserMode ? () => store.setMode("user") : undefined}
      onGo={() => writeProfileHandoff(store.profile)}
    />
  );
}

/** No saved answers for the active person on this browser: one way forward, to onboarding ("/"). */
export function SetUp({ name }: { name: string }) {
  const known = name !== "You";
  return (
    <section className="max-w-[65ch] space-y-4">
      <h1 className="text-[2.25rem] font-semibold leading-tight">Caregiver view</h1>
      <p>{known ? `${name} has no saved answers on this browser yet.` : "No answers are saved on this browser yet."}</p>
      <Link href="/demo" className={PRIMARY}>
        {known ? `Set up ${name}` : "Start here"}
      </Link>
    </section>
  );
}

export function CareView({
  model,
  unavailable,
  analyzing,
  error,
  onPrimary,
  onGo,
}: {
  model: CareModel;
  unavailable: boolean;
  analyzing: boolean;
  error: string | null;
  onPrimary?: () => void;
  /** Writes the X1 profile handoff (sessionStorage) before any link to /coordinate. */
  onGo?: () => void;
}) {
  const { name } = model;
  const go = (href: string) => (href.startsWith("/coordinate") ? onGo : undefined);
  return (
    <div className="max-w-[52rem] space-y-10">
      <header className="space-y-3">
        <h1 className="text-[2.25rem] font-semibold leading-tight">{possessive(name)} week</h1>
        <p className={META}>
          Same-device demo: no accounts are linked yet. Status is read from this browser&apos;s plans. Simulated rides and invites: nothing is
          really sent.
        </p>
        {unavailable && <p>Live status isn&apos;t available on this server.</p>}
        {analyzing && <p role="status">Finding activities {name} can get to…</p>}
        {error && <p role="status">{error}</p>}
        <div className="pt-2">
          <Link href={model.primary.href} onClick={onPrimary ?? go(model.primary.href)} className={PRIMARY}>
            {model.primary.label}
          </Link>
        </div>
      </header>

      {model.needsFixing.length > 0 && (
        <section aria-labelledby="care-fix" className="space-y-3">
          <h2 id="care-fix" className={H2}>Needs fixing</h2>
          <ul className="space-y-3">
            {model.needsFixing.map((row, i) => (
              <li key={row.activityId} className="space-y-1 border-l-4 border-amber-600 py-2 pl-4 dark:border-amber-400">
                <PlanStatusLabel view={row.view} className="font-semibold" />
                <p>{row.text}</p>
                {row.detail && <p className={META}>{row.detail}</p>}
                {/* The first row is what the primary button opens; don't repeat it. */}
                {i > 0 && (
                  <Link href={row.href} onClick={go(row.href)} className={LINK}>
                    Open with {name}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.approvals.length > 0 && (
        <section aria-labelledby="care-ok" className="space-y-3">
          <h2 id="care-ok" className={H2}>Waiting for {possessive(name)} OK</h2>
          <ul className="divide-y divide-border">
            {model.approvals.map((row) => (
              <li key={row.key} className="py-3">
                <p>{row.what}</p>
                {row.detail && <p className={META}>{row.detail}</p>}
              </li>
            ))}
          </ul>
          <p className={META}>Only {name} can say OK. Open the plan together.</p>
        </section>
      )}

      <section aria-labelledby="care-week" className="space-y-3">
        <h2 id="care-week" className={H2}>This week</h2>
        {model.week.length === 0 ? (
          <p>No outings picked yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {model.week.map((o) => (
              <li key={o.activityId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-6">
                <span className={`${META} shrink-0 sm:w-52`}>{o.whenLabel}</span>
                <Link href={`/activity/${encodeURIComponent(o.activityId)}?from=care`} className={`${LINK} flex-1 no-underline hover:underline`}>
                  {o.name}
                </Link>
                {!unavailable && <PlanStatusLabel view={o.view} className="shrink-0" />}
              </li>
            ))}
          </ul>
        )}
        {model.noPlansYet && model.startHref && !unavailable && (
          <p className={META}>
            Not started — open{" "}
            <Link href={model.startHref} onClick={onGo} className={LINK}>
              Get me there
            </Link>{" "}
            with {name} to coordinate.
          </p>
        )}
      </section>

      {!unavailable && (
        <section aria-labelledby="care-shared" className="space-y-3">
          <h2 id="care-shared" className={H2}>What was shared</h2>
          {model.shared.length === 0 ? (
            <p>Nothing has been shared yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {model.shared.map((row) => (
                <li key={row.key} className="py-3">
                  <p>
                    <span className={row.revoked ? "line-through" : undefined}>
                      {row.recipient} · {row.kind} for {row.outing}
                    </span>
                    {row.revoked && <span className="ml-2 font-semibold">Revoked</span>}
                  </p>
                  <p className={`${META} ${row.revoked ? "line-through" : ""}`}>Shared: {row.fields}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
