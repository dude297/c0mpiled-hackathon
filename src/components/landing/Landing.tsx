"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ACTIVITIES } from "@/domain/activities";
import { DEMO_SCENARIOS } from "@/domain/coordination/demo";
import { checkActivity } from "@/domain/engine";
import "./landing.css";

// Global stylesheet with lp- prefixed classes; s.foo -> "lp-foo".
const s = new Proxy({} as Record<string, string>, { get: (_, k) => `lp-${String(k)}` });

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
const maya = DEMO_SCENARIOS.maya;
const DWELL_MS = 7000;

// Scene 2 runs the real barrier engine on the demo profile, so the landing page can't claim what the product doesn't do.
const VERDICTS = ["fellowship", "choir", "cooking", "concert", "foodbank"].flatMap((id) => {
  const a = ACTIVITIES.find((x) => x.id === id);
  if (!a) return [];
  const hard = checkActivity(maya.profile, a).find((c) => !c.ok);
  return [{ name: a.name, fits: !hard, why: hard?.detail ?? `${a.day} ${a.time}` }];
});

/** Adds the "shown" class the first time an element scrolls into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add(s.shown), io.unobserve(e.target))),
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Headline() {
  const lines: React.ReactNode[] = ["A week that", "works around", <em key="h" className={s.gold}>her.</em>];
  return (
    <h1 className={cx(s.display, s.headline)}>
      {lines.map((l, i) => (
        <span key={i} className={s.lineMask}>
          <span className={s.lineIn} style={{ animationDelay: `${250 + i * 160}ms` }}>{l}</span>
        </span>
      ))}
    </h1>
  );
}

function Bridge() {
  return (
    <svg className={s.bridge} viewBox="0 0 1440 400" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} d="M-20 390 C 360 120, 1080 120, 1460 390" />
      <path pathLength={1} d="M-20 390 C 380 170, 1060 170, 1460 390 M 240 300 V 390 M 480 228 V 390 M 720 205 V 390 M 960 228 V 390 M 1200 300 V 390" />
      <path pathLength={1} d="M-20 396 H 1460" />
    </svg>
  );
}

// ── Scenes (Maya's real demo scenario) ──
function Profile() {
  const p = maya.profile;
  const rows = [
    ["Gets around", `with a ${p.mobility}`],
    ["Rides", p.transport.join(" or ")],
    ["Travel", `${p.maxTravelMin} minutes at most`],
    ["Free", `${p.times.join(" and ")}s`],
    ["Budget", `$${p.budgetPerWeek} a week`],
    ["Prefers", p.prefersSmallGroups ? "small groups" : "any group"],
  ];
  return (
    <div className={cx(s.panel, s.stagger)}>
      {rows.map(([k, v]) => (
        <div key={k} className={s.row}><span className={s.rowLabel}>{k}</span><span className={s.rowValue}>{v}</span></div>
      ))}
    </div>
  );
}

function Fit() {
  return (
    <div className={cx(s.panel, s.stagger)}>
      {VERDICTS.map((v) => (
        <div key={v.name} className={s.row}>
          <span>
            <span className={v.fits ? undefined : s.nope}>{v.name}</span>
            <span className={s.why}>{v.why}</span>
          </span>
          <span className={cx(s.state, v.fits ? s.stateGood : s.stateWait)}>{v.fits ? "fits" : "not this week"}</span>
        </div>
      ))}
    </div>
  );
}

function Ride() {
  const [driver, friend] = [maya.contacts.find((c) => c.canDrive)!, maya.contacts.find((c) => !c.canDrive)!];
  return (
    <svg className={s.route} viewBox="0 0 560 300" role="img" aria-label={`${driver.name} drives Maya to Sunday Fellowship Lunch; ${friend.name} is invited to join`}>
      <path pathLength={1} d="M40 240 C 160 240, 180 70, 300 90 S 470 200, 520 70" />
      <circle cx="40" cy="240" r="7" />
      <circle cx="520" cy="70" r="7" />
      <text className={s.routeLabel} x="40" y="276">Maya&apos;s home</text>
      <text className={s.routeLabel} x="520" y="44" textAnchor="end">Sunday Fellowship Lunch</text>
      <text className={s.routeLabel} x="232" y="150">{driver.name} drives · 10 min</text>
      <text className={s.routeLabel} x="300" y="250">{friend.name} is invited along</text>
    </svg>
  );
}

type Status = "proposed" | "requested" | "confirmed";
function Consent({ onDone }: { onDone?: () => void }) {
  const [status, setStatus] = useState<Status>("proposed");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const approve = () => {
    setStatus("requested");
    timer.current = setTimeout(() => {
      setStatus("confirmed");
      onDone?.();
    }, 1600);
  };
  const label = { proposed: "waiting for her yes", requested: "asked — not yet confirmed", confirmed: "confirmed" }[status];
  const tone = { proposed: s.stateWait, requested: s.stateWarn, confirmed: s.stateGood }[status];
  return (
    <div>
      <div className={cx(s.panel, s.stagger)}>
        {["Ride from Dan", "Invite Elaine to come along"].map((a) => (
          <div key={a} className={s.row}>
            <span>{a}</span>
            <span key={status} className={cx(s.state, tone, s.swap)}>{label}</span>
          </div>
        ))}
        <div className={s.row}>
          <span>The plan</span>
          <span key={status} className={cx(s.state, s.swap, status === "confirmed" ? s.stateGood : s.stateWait)}>
            {status === "confirmed" ? "ready" : "not ready"}
          </span>
        </div>
      </div>
      <button className={s.actionBtn} onClick={approve} disabled={status !== "proposed"}>
        {status === "proposed" ? "Approve both" : status === "requested" ? "Sending to Dan and Elaine…" : "Both said yes"}
      </button>
    </div>
  );
}

function Disruption() {
  const [phase, setPhase] = useState<"ready" | "broken" | "replanned">("ready");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const breakIt = () => {
    setPhase("broken");
    timer.current = setTimeout(() => setPhase("replanned"), 1500);
  };
  const ride = { ready: "Dan · confirmed", broken: "Dan · cancelled", replanned: "Paratransit · needs her yes" }[phase];
  const plan = { ready: "ready", broken: "needs a new plan", replanned: "new plan proposed" }[phase];
  return (
    <div>
      <div className={cx(s.panel, s.stagger)}>
        <div className={s.row}><span>Ride</span><span key={ride} className={cx(s.state, s.swap, phase === "ready" ? s.stateGood : s.stateWarn)}>{ride}</span></div>
        <div className={s.row}><span>Elaine</span><span className={cx(s.state, s.stateGood)}>still coming</span></div>
        <div className={s.row}><span>The plan</span><span key={plan} className={cx(s.state, s.swap, phase === "ready" ? s.stateGood : s.stateWarn)}>{plan}</span></div>
      </div>
      <button className={s.actionBtn} onClick={breakIt} disabled={phase !== "ready"}>
        {phase === "ready" ? "Dan's car won't start" : phase === "broken" ? "Finding another way…" : "Replanned. Nothing sent until she says yes."}
      </button>
    </div>
  );
}

const SCENES = [
  { name: "Who she is", title: "Start with Maya, not a calendar.", body: "Her walker, her rides, her afternoons, her budget. DayBridge plans around the life she actually has.", Art: Profile },
  { name: "What fits", title: "Every reason, checked.", body: "Times, steps at the door, travel, cost and noise — run against every activity. If something rules it out, she sees exactly why.", Art: Fit },
  { name: "Getting there", title: "The ride is part of the plan.", body: "Her son Dan can drive. Her friend Elaine could come along. DayBridge proposes both — and does nothing yet.", Art: Ride },
  { name: "Her yes", title: "Nothing moves without her yes.", body: "Approvals are scoped and expire. Asking is not the same as confirmed — the plan is ready only when Dan and Elaine actually say yes.", Art: Consent },
  { name: "Life happens", title: "When plans break, it replans.", body: "A ride falls through. DayBridge keeps what still works, finds another way there, and asks her again before anything is sent.", Art: Disruption },
] as const;

function Reel() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const go = (n: number) => setI((n + SCENES.length) % SCENES.length);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  // Autoplay while visible; any interaction pauses it for good.
  useEffect(() => {
    if (paused || !inView || reduce) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SCENES.length), DWELL_MS);
    return () => clearTimeout(t);
  }, [i, paused, inView, reduce]);

  const stop = () => setPaused(true);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    stop();
    go(e.key === "ArrowRight" ? i + 1 : i - 1);
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    start.current = e.clientX;
    setDrag(0);
  };
  const onMove = (e: React.PointerEvent) => start.current !== null && setDrag(e.clientX - start.current);
  const onUp = () => {
    if (start.current === null) return;
    if (drag !== null && Math.abs(drag) > 60) {
      stop();
      go(drag < 0 ? i + 1 : i - 1);
    }
    start.current = null;
    setDrag(null);
  };

  return (
    <section ref={ref} id="how" className={cx(s.reel, paused && s.paused)} aria-roledescription="carousel" aria-label="How DayBridge works" onKeyDown={onKey}>
      <div className={s.reelHead}>
        <h2 className={cx(s.display, s.reelTitle, s.reveal)} data-reveal>One Sunday lunch,<br />start to finish.</h2>
        <div className={s.controls}>
          <button className={s.navBtn} onClick={() => (stop(), go(i - 1))} aria-label="Previous scene"><ArrowLeft aria-hidden="true" /></button>
          <span className={s.counter} aria-live="polite">{String(i + 1).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")}</span>
          <button className={s.navBtn} onClick={() => (stop(), go(i + 1))} aria-label="Next scene"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>

      <div
        className={cx(s.viewport, drag !== null && s.dragging)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onMouseEnter={stop}
        onFocus={stop}
      >
        <div className={s.track} style={{ transform: `translateX(calc(${-i * 100}% + ${drag ?? 0}px))` }}>
          {SCENES.map(({ name, title, body, Art }, n) => (
            <article
              key={name}
              className={cx(s.slide, n === i && s.active)}
              aria-roledescription="slide"
              aria-label={`${n + 1} of ${SCENES.length}: ${name}`}
              aria-hidden={n !== i}
              inert={n !== i}
            >
              <div className={s.slideText}>
                <span className={s.chapter}>{String(n + 1).padStart(2, "0")} — {name}</span>
                <h3 className={cx(s.display, s.slideTitle)}>{title}</h3>
                <p className={s.slideBody}>{body}</p>
              </div>
              <div className={s.slideArt}>{Art === Consent ? <Consent onDone={stop} /> : <Art />}</div>
            </article>
          ))}
        </div>
      </div>

      <div className={s.progress} style={{ ["--dwell" as string]: `${DWELL_MS}ms` }}>
        {SCENES.map(({ name }, n) => (
          <button
            key={`${name}-${n === i ? i : "x"}`}
            className={cx(s.step, n < i && s.stepDone, n === i && s.stepNow)}
            onClick={() => (stop(), go(n))}
            aria-label={`Go to scene ${n + 1}: ${name}`}
            aria-current={n === i ? "step" : undefined}
          >
            <span className={s.stepLine}><span className={s.stepFill} /></span>
            <span className={s.stepName}>{String(n + 1).padStart(2, "0")} {name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Landing() {
  useReveal();
  return (
    <div className={s.page}>
      <div className={s.grain} aria-hidden="true" />
      <header className={s.bar}>
        <Link href="/" className={cx(s.display, s.mark)}>DayBridge</Link>
        <Link href="/demo" className={s.textLink}>Try the demo <span className={s.arrow} aria-hidden="true">→</span></Link>
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.dawn} aria-hidden="true" />
          <Bridge />
          <span className={s.eyebrow}>For older adults and the people who care for them</span>
          <Headline />
          <p className={s.lede}>
            DayBridge finds activities she can actually get to — then arranges the ride with her yes, and replans when life changes.
          </p>
          <div className={s.ctaRow}>
            <Link href="/demo" className={s.cta}><span>Try it now</span><span className={s.arrow} aria-hidden="true">→</span></Link>
            <a href="#how" className={s.textLink}>See how it works <span className={s.arrow} aria-hidden="true">↓</span></a>
          </div>
          <span className={s.cue} aria-hidden="true" />
        </section>

        <section className={s.statement} aria-label="Why it matters">
          <p className={cx(s.display, s.reveal)} data-reveal>The bus takes fifty minutes.</p>
          <p className={cx(s.display, s.reveal, s.revealRight)} data-reveal>The hall has stairs.</p>
          <p className={cx(s.display, s.reveal)} data-reveal>The room is too loud to hear.</p>
          <p className={cx(s.display, s.reveal, s.revealUp, s.gold)} data-reveal>So she stays home.</p>
          <p className={cx(s.display, s.reveal, s.revealUp, s.quiet)} data-reveal>The invitation was never the hard part.</p>
        </section>

        <Reel />

        <section className={s.principles} aria-label="Principles">
          {[
            ["Her yes, every time.", "Invites and rides go out only under a scoped approval she gave — and it expires."],
            ["Asked isn't confirmed.", "A plan is ready only when the people involved actually say yes. No guessing."],
            ["Change is expected.", "When something falls through, DayBridge keeps what works and finds another way."],
          ].map(([t, b]) => (
            <div key={t} className={cx(s.principle, s.reveal, s.revealUp)} data-reveal>
              <h3 className={s.display}>{t}</h3>
              <p>{b}</p>
            </div>
          ))}
        </section>

        <section className={s.finale}>
          <h2 className={cx(s.display, s.finaleTitle, s.reveal, s.revealUp)} data-reveal>See it with<br /><em className={s.gold}>a real week.</em></h2>
          <Link href="/demo" className={cx(s.cta, s.reveal, s.revealUp)} data-reveal><span>Try it now</span><span className={s.arrow} aria-hidden="true">→</span></Link>
          <p className={s.footnote}>
            The demo uses sample people and simulated providers. No real messages are sent and no rides are booked.
          </p>
        </section>
      </main>

      <footer className={s.foot}>
        <span className={s.display}>DayBridge</span>
        <span>Built at the c0mpiled hackathon</span>
      </footer>
    </div>
  );
}
