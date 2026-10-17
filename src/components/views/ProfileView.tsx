"use client";

// U6 Profile (docs/product/SCREENS.md). Same rows as the onboarding review; one row open at a time.
// Save writes the answers and re-plans through the device store. Start over clears this person, with Undo.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { FOCUS } from "@/components/shell/focus";
import { StartHere } from "@/components/shell/ProfileGate";
import { personLabel, useDeviceStore } from "@/components/shell/store";
import { INTEREST_META, TRANSPORT_OPTIONS, TRAVEL_BUCKETS, WALKING_AID_OPTIONS } from "@/components/onboarding/CardDeck";
import type { Profile } from "@/lib/schema";
import { AnalyzeLine, PRIMARY_BTN, QUIET_LINK, SampleNote } from "./bits";
import { BUDGET_CHOICES, TIME_CHOICES, budgetText, cleanName, draftProblem, profileRows, travelText, type ProfileField, type ProfileRow } from "./format";
import { restoreSnapshot, takeSnapshot, type Snapshot } from "./undo";

export function ProfileView() {
  const s = useDeviceStore();
  const [undo, setUndo] = useState<Snapshot | null>(null);
  const closeUndo = useCallback(() => setUndo(null), []);
  const caregiver = s.mode === "caregiver";
  const title = s.ready && caregiver && s.profile ? `${personLabel(s)}'s answers` : "Your answers";

  return (
    <div className="space-y-6 pb-24">
      <h1 className="text-[2.25rem] font-semibold leading-tight">{title}</h1>
      {s.ready && (s.profile ? <Answers onStartOver={setUndo} /> : <StartHere />)}
      {undo && <UndoToast snapshot={undo} onDone={closeUndo} />}
    </div>
  );
}

function Answers({ onStartOver }: { onStartOver: (s: Snapshot) => void }) {
  const store = useDeviceStore();
  const profile = store.profile!;
  const [open, setOpen] = useState<ProfileField | null>(null);
  const [saved, setSaved] = useState(false);
  const rows = profileRows(profile);

  const save = async (next: Profile) => {
    setOpen(null);
    setSaved(false);
    const r = await store.analyze(next);
    if (r) setSaved(true);
  };

  const rowList = (list: ProfileRow[]) => (
    <ul className="divide-y border-y">
      {list.map((row) => (
        <Row
          key={row.field}
          row={row}
          open={open === row.field}
          onToggle={() => setOpen(open === row.field ? null : row.field)}
          profile={profile}
          onSave={save}
          busy={store.analyzing}
        />
      ))}
    </ul>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <SampleNote />
        <p className="text-foreground/80">Change one answer at a time. Saving updates your matches.</p>
      </div>

      {rowList(rows.filter((r) => !r.optional))}

      <details className="group" open={open === "hearingImpaired" || open === "prefersSmallGroups" ? true : undefined}>
        <summary className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg text-lg font-medium ${FOCUS}`}>
          Optional: hearing and group size
        </summary>
        <div className="mt-2">{rowList(rows.filter((r) => r.optional))}</div>
      </details>

      <div aria-live="polite" className="space-y-2">
        {store.analyzing ? (
          <p role="status">Updating your matches…</p>
        ) : store.error ? (
          <AnalyzeLine />
        ) : saved ? (
          <p>
            Saved. Your matches are updated.{" "}
            {store.dropped.length > 0 && (
              <>
                {store.dropped.map((d) => d.name).join(", ")} no longer {store.dropped.length === 1 ? "fits" : "fit"}.{" "}
              </>
            )}
            <Link href="/matches" className={QUIET_LINK}>See matches</Link>
          </p>
        ) : null}
      </div>

      <div className="border-t pt-6">
        <button
          type="button"
          onClick={() => {
            const snap = takeSnapshot(store);
            store.reset();
            onStartOver(snap);
          }}
          className={`inline-flex min-h-11 items-center rounded-lg px-2 text-lg text-foreground/80 underline underline-offset-4 hover:text-foreground ${FOCUS}`}
        >
          Start over
        </button>
        <p className="text-base text-muted-foreground">Clears {personLabel(store)}&apos;s answers on this browser. Other people are kept.</p>
      </div>
    </div>
  );
}

function Row({ row, open, onToggle, profile, onSave, busy }: {
  row: ProfileRow;
  open: boolean;
  onToggle: () => void;
  profile: Profile;
  onSave: (p: Profile) => void;
  busy: boolean;
}) {
  const panelId = useId();
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-base text-foreground/75">{row.label}</p>
          <p className="font-medium">{row.value}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className={`inline-flex min-h-11 items-center rounded-lg px-3 text-lg font-medium text-primary hover:bg-muted ${FOCUS}`}
        >
          {open ? "Close" : "Change"}
          <span className="sr-only"> {row.label.toLowerCase()}</span>
        </button>
      </div>
      {open && (
        <div id={panelId}>
          <Editor field={row.field} label={row.label} profile={profile} onSave={onSave} onCancel={onToggle} busy={busy} />
        </div>
      )}
    </li>
  );
}

const TILE = `flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground`;
const BOX = "size-5 shrink-0 accent-[var(--primary)]";

function Editor({ field, label, profile, onSave, onCancel, busy }: {
  field: ProfileField;
  label: string;
  profile: Profile;
  onSave: (p: Profile) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Profile>(profile);
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => {
    first.current?.querySelector<HTMLElement>("input")?.focus();
  }, []);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggle = <T extends string>(list: readonly T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const problem = draftProblem(draft);

  const many = <T extends string>(k: "interests" | "times" | "transport", opts: readonly { key: T; label: string }[]) => (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">{label}, pick any</legend>
      {opts.map((o) => (
        <label key={o.key} className={TILE}>
          <input
            type="checkbox"
            className={BOX}
            checked={(draft[k] as readonly string[]).includes(o.key)}
            onChange={() => set(k, toggle(draft[k] as readonly string[], o.key) as Profile[typeof k])}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );

  const one = <V extends string | number>(name: string, opts: readonly { value: V; label: string }[], value: V, onPick: (v: V) => void) => (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{label}, pick one</legend>
      {opts.map((o) => (
        <label key={String(o.value)} className={TILE}>
          <input type="radio" name={name} className={BOX} checked={value === o.value} onChange={() => onPick(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );

  // Keep an unusual saved value as a choice so nothing is silently changed.
  const travelOpts = TRAVEL_BUCKETS.map((b) => ({ value: b.min as number, label: `${b.label} (${b.detail})` }));
  if (!travelOpts.some((o) => o.value === profile.maxTravelMin)) travelOpts.push({ value: profile.maxTravelMin, label: travelText(profile.maxTravelMin) });
  const budgetOpts = BUDGET_CHOICES.map((b) => ({ value: b.amount, label: `${b.label} (${b.detail})` }));
  if (!budgetOpts.some((o) => o.value === profile.budgetPerWeek)) budgetOpts.push({ value: profile.budgetPerWeek, label: budgetText(profile.budgetPerWeek) });

  let control: React.ReactNode;
  switch (field) {
    case "name":
      control = (
        <label className="block">
          <span className="sr-only">Name</span>
          <input
            type="text"
            value={draft.name}
            maxLength={60}
            autoComplete="given-name"
            onChange={(e) => set("name", e.target.value)}
            className={`min-h-14 w-full max-w-md rounded-xl border bg-background px-4 text-lg ${FOCUS}`}
          />
        </label>
      );
      break;
    case "interests": control = many("interests", INTEREST_META); break;
    case "times": control = many("times", TIME_CHOICES); break;
    case "transport": control = many("transport", TRANSPORT_OPTIONS); break;
    case "maxTravelMin": control = one("travel", travelOpts, draft.maxTravelMin, (v) => set("maxTravelMin", v)); break;
    case "budgetPerWeek": control = one("budget", budgetOpts, draft.budgetPerWeek, (v) => set("budgetPerWeek", v)); break;
    case "mobility":
      control = one("mobility", WALKING_AID_OPTIONS.map((o) => ({ value: o.key, label: o.label })), draft.mobility, (v) => set("mobility", v));
      break;
    case "hearingImpaired":
      control = (
        <label className={TILE}>
          <input type="checkbox" className={BOX} checked={draft.hearingImpaired} onChange={(e) => set("hearingImpaired", e.target.checked)} />
          Hard of hearing: look for quiet rooms or a hearing loop
        </label>
      );
      break;
    case "prefersSmallGroups":
      control = (
        <label className={TILE}>
          <input type="checkbox" className={BOX} checked={draft.prefersSmallGroups} onChange={(e) => set("prefersSmallGroups", e.target.checked)} />
          Prefers small groups
        </label>
      );
      break;
  }

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || busy) return;
        onSave({ ...draft, name: cleanName(draft.name) });
      }}
    >
      <div ref={first}>{control}</div>
      {problem && <p className="text-base text-foreground/85">{problem}</p>}
      {/* Thumb-reachable on phones: the open row's Save sticks to the bottom of the screen. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t bg-background px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <button type="submit" disabled={!!problem || busy} className={`${PRIMARY_BTN} flex-1 sm:flex-none`}>
          Save
        </button>
        <button type="button" onClick={onCancel} className={`inline-flex min-h-11 items-center rounded-lg px-3 text-lg hover:bg-muted ${FOCUS}`}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function UndoToast({ snapshot, onDone }: { snapshot: Snapshot; onDone: () => void }) {
  const store = useDeviceStore();
  useEffect(() => {
    const t = window.setTimeout(onDone, 10000);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div role="status" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-4 rounded-xl border bg-popover px-4 py-3 text-popover-foreground shadow-lg print:hidden">
      <p>Answers cleared.</p>
      <button
        type="button"
        onClick={() => {
          restoreSnapshot(snapshot, store);
          onDone();
        }}
        className={`inline-flex min-h-11 items-center rounded-lg px-4 text-lg font-semibold text-primary hover:bg-muted ${FOCUS}`}
      >
        Undo
      </button>
    </div>
  );
}
