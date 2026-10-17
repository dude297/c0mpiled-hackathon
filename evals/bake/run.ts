// Synthetic people bake: proves the DayBridge planner is a real engine, not canned output.
// Run: npx tsx evals/bake/run.ts   (dev server on http://localhost:3000 for the API checks)
// Writes evals/bake/REPORT.md. Read-only against src/: it only imports the engine and data.
// Exit code: 0 only when EVERY check ran and passed. API unreachable, skipped cases, schema-invalid
// people, bad input not rejected, contract breaks, or a missed negative control all exit 1.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ACTIVITIES, DEMO_PROFILES, type Activity } from "../../src/domain/activities";
import { runScenario, type DomainOutput } from "../../src/domain/engine";
import { Profile, type AnalysisResult, type CommandResult, type Contact } from "../../src/lib/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BAKE_BASE_URL ?? "http://localhost:3000";
type P = Profile;
type Mode = P["transport"][number];
type Person = { id: string; note: string; profile: P };

const people: Person[] = JSON.parse(readFileSync(join(HERE, "people.json"), "utf8"));
const byId = new Map(ACTIVITIES.map((a) => [a.id, a]));
const byName = new Map(ACTIVITIES.map((a) => [a.name, a]));

// ── Independent oracle: re-derives every rule straight from ACTIVITIES + the documented product rules.
//    It never calls checkActivity / bestRoute / runScenario. ──
const CAN_WALK = new Set(["full", "cane"]); // product rule: walker/wheelchair users don't count "walk" as a route
const usableModes = (p: P, a: Activity) =>
  p.transport.filter((m) => (m !== "walk" || CAN_WALK.has(p.mobility)) && a.travelMin[m] !== undefined);
function reachable(p: P, a: Activity) {
  return usableModes(p, a).some((m) => a.travelMin[m]! <= p.maxTravelMin);
}
// Route rule (product doc: "prefer an independent route over relying on family"): among modes within the limit,
// the fastest non-family mode (ties by mode name); family only when nothing else fits.
function oracleRoute(p: P, a: Activity): { mode: Mode; min: number } | null {
  const fit = usableModes(p, a).map((m) => ({ mode: m, min: a.travelMin[m]! })).filter((r) => r.min <= p.maxTravelMin);
  const indep = fit.filter((r) => r.mode !== "family").sort((x, y) => x.min - y.min || (x.mode < y.mode ? -1 : 1));
  return indep[0] ?? fit.find((r) => r.mode === "family") ?? null;
}
function hardReasons(p: P, a: Activity): string[] {
  const r: string[] = [];
  if (!p.times.includes(a.time)) r.push("time");
  if (!a.stepFree && (p.mobility === "walker" || p.mobility === "wheelchair")) r.push("access");
  if (!reachable(p, a)) r.push("transport");
  if (a.costPerWeek > p.budgetPerWeek) r.push("cost");
  return r;
}
// Soft barriers (feasible, needs a mitigation): cane + stairs, family-only or paratransit ride, noisy room without a
// loop for a hearing-impaired person, a large group for someone who prefers small groups.
function softReasons(p: P, a: Activity): string[] {
  const r: string[] = [];
  if (!a.stepFree && p.mobility === "cane") r.push("access");
  const route = oracleRoute(p, a);
  if (route && (route.mode === "family" || route.mode === "paratransit")) r.push("transport");
  if (p.hearingImpaired && a.noisy && !a.hearingLoop) r.push("hearing");
  if (p.prefersSmallGroups && a.groupSize === "large") r.push("social");
  return r.sort();
}
const matchCount = (p: P, a: Activity) => a.tags.filter((t) => p.interests.includes(t)).length;
// Documented score: 10 × matching interests − 2 × soft barriers − travel minutes / 10 (1 decimal).
const oracleScore = (p: P, a: Activity) =>
  Math.round((10 * matchCount(p, a) - 2 * softReasons(p, a).length - (oracleRoute(p, a)?.min ?? 0) / 10) * 10) / 10;
const relevant = (p: P) => ACTIVITIES.filter((a) => a.tags.some((t) => p.interests.includes(t)));
const oracleFeasible = (p: P) => relevant(p).filter((a) => hardReasons(p, a).length === 0).map((a) => a.id).sort();
// Greedy weekly plan from the oracle's own scores: best first, one per day, ≤3 items, cumulative budget.
// tie = +1 breaks equal scores by id A→Z (the documented order); tie = −1 reverses it to detect plans a tie decided.
function oraclePlan(p: P, tie: 1 | -1 = 1): string[] {
  const ranked = relevant(p).filter((a) => !hardReasons(p, a).length)
    .sort((x, y) => oracleScore(p, y) - oracleScore(p, x) || tie * (x.id < y.id ? -1 : 1));
  const out: string[] = [], days = new Set<string>();
  let spent = 0;
  for (const a of ranked) {
    if (out.length >= 3 || days.has(a.day) || spent + a.costPerWeek > p.budgetPerWeek) continue;
    out.push(a.id); days.add(a.day); spent += a.costPerWeek;
  }
  return out;
}
// A tie "decides" the plan only if reversing the tie-break changes WHICH activities are planned (not just their order).
const tieDecided = (p: P) => !isDeepStrictEqual([...oraclePlan(p, 1)].sort(), [...oraclePlan(p, -1)].sort());
const engineFeasible = (o: DomainOutput, p: P) => {
  const blocked = new Set(o.blocked.map((b) => b.name));
  return relevant(p).filter((a) => !blocked.has(a.name)).map((a) => a.id).sort();
};

// ── Invariant checks on one engine output ──
function checkInvariants(p: P, o: DomainOutput): string[] {
  const fails: string[] = [];
  let spent = 0;
  const days = new Set<string>();
  if (o.plan.length > 3) fails.push(`plan has ${o.plan.length} items (>3)`);
  for (const it of o.plan) {
    const a = byId.get(it.activityId);
    if (!a) { fails.push(`plan item ${it.activityId} not in catalog`); continue; }
    const hr = hardReasons(p, a);
    if (hr.length) fails.push(`HARD VIOLATION: ${a.id} planned but violates ${hr.join(",")}`);
    if (!a.tags.some((t) => p.interests.includes(t))) fails.push(`${a.id} planned with no matching interest`);
    if (it.when !== `${a.day} ${a.time}`) fails.push(`${a.id} wrong 'when' ${it.when}`);
    if (it.costPerWeek !== a.costPerWeek) fails.push(`${a.id} wrong cost`);
    const m = /^(\w+), (\d+) min$/.exec(it.travel);
    if (!m) fails.push(`${a.id} unparseable travel "${it.travel}"`);
    else {
      const [mode, min] = [m[1] as Mode, Number(m[2])];
      if (!p.transport.includes(mode)) fails.push(`${a.id} uses mode ${mode} the person doesn't have`);
      if (a.travelMin[mode] !== min) fails.push(`${a.id} travel ${min} != catalog ${a.travelMin[mode]}`);
      if (min > p.maxTravelMin) fails.push(`${a.id} travel ${min} > limit ${p.maxTravelMin}`);
      if (mode === "walk" && !CAN_WALK.has(p.mobility)) fails.push(`${a.id} walk route for ${p.mobility} user`);
      const r = oracleRoute(p, a);
      if (r && (r.mode !== mode || r.min !== min)) fails.push(`${a.id} route ${mode} ${min} ≠ expected ${r.mode} ${r.min}`);
    }
    if (days.has(a.day)) fails.push(`two plan items on ${a.day}`);
    days.add(a.day);
    spent += a.costPerWeek;
    if (it.barriers.some((b) => b.severity === "hard")) fails.push(`${a.id} planned with a hard barrier`);
    // Soft barriers: exactly the true ones, each with a mitigation (catches a dropped or mislabeled hearing/social/etc.).
    const soft = it.barriers.filter((b) => b.severity === "soft");
    const got = soft.map((b) => b.rule).sort(), want = softReasons(p, a);
    if (!isDeepStrictEqual(got, want)) fails.push(`SOFT MISMATCH: ${a.id} soft barriers [${got}] ≠ true [${want}]`);
    for (const b of soft) if (!b.mitigation) fails.push(`${a.id} soft barrier "${b.rule}" has no mitigation`);
    if (it.score !== oracleScore(p, a)) fails.push(`${a.id} score ${it.score} ≠ recomputed ${oracleScore(p, a)}`);
  }
  if (spent > p.budgetPerWeek) fails.push(`HARD VIOLATION: cumulative cost $${spent} > budget $${p.budgetPerWeek}`);

  // Blocked: each has ≥1 hard barrier, every hard barrier is true, and the blocked set equals the oracle's.
  for (const b of o.blocked) {
    const a = byName.get(b.name);
    if (!a) { fails.push(`blocked ${b.name} not in catalog`); continue; }
    const truth = hardReasons(p, a);
    if (!b.barriers.length) fails.push(`${a.id} blocked with no hard barrier`);
    for (const x of b.barriers) if (x.severity !== "hard" || !truth.includes(x.rule)) fails.push(`${a.id} blocked for "${x.rule}" which is not true`);
    for (const t of truth) if (!b.barriers.some((x) => x.rule === t)) fails.push(`${a.id} blocked but missing true reason "${t}"`);
  }
  const ef = engineFeasible(o, p), of = oracleFeasible(p);
  if (!isDeepStrictEqual(ef, of)) fails.push(`feasible set mismatch engine=[${ef}] oracle=[${of}]`);

  // Maximal: with fewer than 3 items, no feasible activity on a free day that fits the remaining budget was left out.
  if (o.plan.length < 3) {
    const planned = new Set(o.plan.map((i) => i.activityId));
    for (const id of of) {
      const a = byId.get(id)!;
      if (!planned.has(id) && !days.has(a.day) && spent + a.costPerWeek <= p.budgetPerWeek)
        fails.push(`plan not maximal: ${id} fits (free day, in budget) but was left out`);
    }
  }
  // Ranking: the plan must equal the oracle's own greedy plan (scores recomputed independently).
  const op = oraclePlan(p);
  if (!isDeepStrictEqual(o.plan.map((i) => i.activityId), op)) fails.push(`ranking mismatch engine=[${o.plan.map((i) => i.activityId)}] oracle=[${op}]`);
  return fails;
}

const sig = (o: DomainOutput) => o.plan.map((i) => i.activityId).join("+") || "(empty)";
const planShape = (o: DomainOutput) => o.plan.map((i) => ({ id: i.activityId, travel: i.travel, score: i.score, cost: i.costPerWeek, barriers: i.barriers }));
const barrierSig = (o: DomainOutput) => JSON.stringify(o.plan.map((i) => [i.activityId, i.score, i.barriers.map((b) => b.rule).sort()]));

// Derived explanation for "plan changed, feasible set same": per-activity score / soft-barrier / route diffs,
// plus whether a tie-break decided the new plan. Nothing here is a canned string keyed on the mutation.
function explainChange(p: P, q: P, before: DomainOutput, after: DomainOutput): string {
  const ids = [...new Set([...before.plan, ...after.plan].map((i) => i.activityId))];
  const parts = ids.flatMap((id) => {
    const a = byId.get(id)!;
    const s0 = oracleScore(p, a), s1 = oracleScore(q, a);
    const r0 = oracleRoute(p, a), r1 = oracleRoute(q, a);
    const sf0 = softReasons(p, a), sf1 = softReasons(q, a);
    const d: string[] = [];
    if (s0 !== s1) d.push(`score ${s0}→${s1}`);
    for (const x of sf0) if (!sf1.includes(x)) d.push(`−${x} soft`);
    for (const x of sf1) if (!sf0.includes(x)) d.push(`+${x} soft`);
    if (r0 && r1 && (r0.mode !== r1.mode || r0.min !== r1.min)) d.push(`route ${r0.mode} ${r0.min}→${r1.mode} ${r1.min}`);
    return d.length ? [`${id}: ${d.join(", ")}`] : [];
  });
  if (q.budgetPerWeek !== p.budgetPerWeek) parts.push(`cumulative budget $${p.budgetPerWeek}→$${q.budgetPerWeek} (each item fit alone; the total now ${q.budgetPerWeek > p.budgetPerWeek ? "fits more" : "fits less"})`);
  if (tieDecided(q)) {
    const ranked = oraclePlan(q, 1), alt = oraclePlan(q, -1);
    parts.push(`TIE: equal scores, the A→Z id tie-break picks [${ranked}] over [${alt}]`);
  }
  return parts.join("; ") || "no derivable reason";
}

// ── HTTP helpers ──
let apiUp = true;
async function post(path: string, body: unknown): Promise<{ status: number; json: unknown } | null> {
  if (!apiUp) return null;
  try {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    return { status: r.status, json: await r.json() };
  } catch (e) {
    apiUp = false;
    console.error(`API unreachable at ${BASE}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

type Row = { id: string; name: string; note: string; relevant: number; feasible: number; blocked: number; plan: string; planNames: string; spent: number; fails: string[]; api: string; expl: string; det: boolean; rename: boolean; perm: boolean; tie: boolean };

async function main() {
  const rows: Row[] = [];
  const bugs: string[] = []; // engine / API behavior that is wrong
  const incomplete: string[] = []; // checks that did not run (also exit 1)
  const schemaErrors: string[] = [];
  const dataSources = new Set<string>();
  let apiResponses = 0, honestCount = 0;

  for (const per of people) {
    const parsed = Profile.safeParse(per.profile);
    if (!parsed.success) { schemaErrors.push(`${per.id}: ${parsed.error.issues[0]?.message}`); continue; }
    const p = parsed.data;
    const o = runScenario({ profile: p });
    const fails = checkInvariants(p, o);

    const det = isDeepStrictEqual(o, runScenario({ profile: structuredClone(p) }));
    if (!det) fails.push("non-deterministic output");
    const rev: P = { ...p, interests: [...p.interests].reverse(), transport: [...p.transport].reverse(), times: [...p.times].reverse() };
    const perm = isDeepStrictEqual(planShape(o), planShape(runScenario({ profile: rev })));
    if (!perm) fails.push("plan depends on the ORDER of interests/transport/times");
    const renamed = runScenario({ profile: { ...p, name: "Zed" } });
    const rename = isDeepStrictEqual(planShape(o), planShape(renamed)) && isDeepStrictEqual(o.blocked.map((b) => b.name), renamed.blocked.map((b) => b.name));
    if (!rename) fails.push("plan changes when the name changes");

    let api = "SKIPPED", expl = "SKIPPED";
    const res = await post("/api/analyze", { profile: p });
    if (!res) incomplete.push(`${per.id}: /api/analyze not checked (API unreachable)`);
    else {
      apiResponses++;
      if (res.status !== 200) { api = `HTTP ${res.status}`; fails.push(`api HTTP ${res.status}`); }
      else {
        const { explanation, dataSource, ...rest } = res.json as AnalysisResult;
        api = isDeepStrictEqual(rest, JSON.parse(JSON.stringify(o))) ? "match" : "MISMATCH";
        if (api !== "match") fails.push("API output differs from engine");
        dataSources.add(dataSource);
        const isMockText = typeof explanation === "string" && explanation.startsWith("[mock AI]");
        const honest = (dataSource === "mock" && isMockText) || (dataSource === "live" && typeof explanation === "string" && !explanation.includes("[mock AI]"));
        const namesPlan = dataSource !== "mock" || o.plan.every((i) => explanation.includes(i.name));
        if (honest) honestCount++;
        expl = honest && namesPlan ? `${dataSource} ✓` : `${dataSource} ✗`;
        if (!honest) fails.push(`explanation label dishonest: dataSource=${dataSource} text="${String(explanation).slice(0, 40)}"`);
        if (!namesPlan) fails.push("mock explanation doesn't name the planned activities");
      }
    }
    for (const f of fails) bugs.push(`${per.id} ${p.name}: ${f}`);
    if (!res) fails.push("SKIPPED: API checks did not run");
    rows.push({
      id: per.id, name: p.name, note: per.note, relevant: relevant(p).length, feasible: oracleFeasible(p).length, blocked: o.blocked.length,
      plan: sig(o), planNames: o.plan.map((i) => `${i.name} (${i.when}, ${i.travel}${i.barriers.length ? `; soft: ${i.barriers.map((b) => b.rule).join("/")}` : ""})`).join("; ") || "—",
      spent: o.plan.reduce((n, i) => n + i.costPerWeek, 0), fails, api, expl, det, rename, perm, tie: tieDecided(p),
    });
  }
  for (const s of schemaErrors) incomplete.push(`people.json ${s} (person skipped)`);

  // ── Negative control: tamper with real outputs; the oracle must catch every planted violation ──
  const pp = (id: string) => people.find((x) => x.id === id)!.profile;
  const findSoft = (rule: string) => {
    for (const per of people) {
      const o = runScenario({ profile: per.profile });
      const i = o.plan.findIndex((it) => it.barriers.some((b) => b.rule === rule && b.severity === "soft"));
      if (i >= 0) return { p: per.profile, o: structuredClone(o), i };
    }
    return null;
  };
  const controls: [string, RegExp, () => string[] | null][] = [
    ["stairs venue planted for a walker", /HARD VIOLATION: choir .*access/, () => {
      const p = pp("p25"), o = structuredClone(runScenario({ profile: p })), a = byId.get("choir")!;
      o.plan.push({ activityId: a.id, name: a.name, when: `${a.day} ${a.time}`, travel: "drive, 10 min", costPerWeek: 0, score: 9, barriers: [] });
      return checkInvariants(p, o);
    }],
    ["over-budget plan", /HARD VIOLATION: cumulative cost/, () => {
      const p = pp("p28"), o = structuredClone(runScenario({ profile: p })), a = byId.get("concert")!;
      o.plan.push({ activityId: a.id, name: a.name, when: `${a.day} ${a.time}`, travel: "family, 20 min", costPerWeek: 15, score: 9, barriers: [{ rule: "transport", severity: "soft", detail: "x", mitigation: "x" }] });
      return checkInvariants(p, o);
    }],
    ["false blocked reason", /blocked for "time" which is not true/, () => {
      const p = pp("p25"), o = structuredClone(runScenario({ profile: p }));
      o.blocked[0].barriers.push({ rule: "time", severity: "hard", detail: "planted" });
      return checkInvariants(p, o);
    }],
    ["mode the person doesn't have", /uses mode drive/, () => {
      const p = pp("p05"), o = structuredClone(runScenario({ profile: p }));
      o.plan[0].travel = "drive, 6 min";
      return checkInvariants(p, o);
    }],
    ["feasible activity silently dropped", /plan not maximal/, () => {
      const p = pp("p16"), o = structuredClone(runScenario({ profile: p }));
      o.plan = [];
      return checkInvariants(p, o);
    }],
    ["hearing soft barrier dropped", /SOFT MISMATCH: .*\[hearing\]/, () => {
      const c = findSoft("hearing"); if (!c) return null;
      c.o.plan[c.i].barriers = c.o.plan[c.i].barriers.filter((b) => b.rule !== "hearing");
      return checkInvariants(c.p, c.o);
    }],
    ["small-group (social) barrier mislabeled as hearing", /SOFT MISMATCH: .*\[hearing.*≠ true \[social/, () => {
      const c = findSoft("social"); if (!c) return null;
      c.o.plan[c.i].barriers = c.o.plan[c.i].barriers.map((b) => (b.rule === "social" ? { ...b, rule: "hearing" } : b));
      return checkInvariants(c.p, c.o);
    }],
    ["cane stairs barrier dropped", /SOFT MISMATCH: .*≠ true \[access/, () => {
      const c = findSoft("access"); if (!c) return null;
      c.o.plan[c.i].barriers = c.o.plan[c.i].barriers.filter((b) => b.rule !== "access");
      return checkInvariants(c.p, c.o);
    }],
    ["lower-ranked activity swapped in (same day, feasible)", /ranking mismatch/, () => {
      for (const per of people) {
        const p = per.profile, o = structuredClone(runScenario({ profile: p }));
        for (let i = 0; i < o.plan.length; i++) {
          const day = byId.get(o.plan[i].activityId)!.day;
          const alt = relevant(p).find((a) => a.day === day && a.id !== o.plan[i].activityId && !hardReasons(p, a).length && a.costPerWeek <= o.plan[i].costPerWeek);
          if (!alt) continue;
          const r = oracleRoute(p, alt)!;
          o.plan[i] = { ...o.plan[i], activityId: alt.id, name: alt.name, when: `${alt.day} ${alt.time}`, travel: `${r.mode}, ${r.min} min`, costPerWeek: alt.costPerWeek, score: oracleScore(p, alt), barriers: softReasons(p, alt).map((rule) => ({ rule, severity: "soft" as const, detail: "x", mitigation: "x" })) };
          return checkInvariants(p, o);
        }
      }
      return null;
    }],
  ];
  // Caught = the SPECIFIC check aimed at the planted defect fired (not just any failure).
  const controlResults = controls.map(([label, rx, fn]) => {
    const f = fn();
    const hit = f?.find((x) => rx.test(x));
    return `${label}: ${f === null ? "NO CANDIDATE ✗ (control could not run)" : hit ? `caught ✓ (${hit})` : `MISSED ✗ (${f.length ? `only: ${f[0]}` : "no failure"})`}`;
  });
  for (const c of controlResults) if (!c.includes("caught")) bugs.push(`negative control failed — ${c}`);

  // ── Bad input must be rejected by the API, not silently planned ──
  const badInputs: [string, unknown][] = [
    ["no interests", { ...people[0].profile, interests: [] }],
    ["unknown mobility", { ...people[0].profile, mobility: "jetpack" }],
    ["negative budget", { ...people[0].profile, budgetPerWeek: -1 }],
    ["travel limit 0", { ...people[0].profile, maxTravelMin: 0 }],
  ];
  const badResults: string[] = [];
  for (const [label, prof] of badInputs) {
    const r = await post("/api/analyze", { profile: prof });
    if (!r) { badResults.push(`${label}: SKIPPED`); incomplete.push(`bad input "${label}" not checked (API unreachable)`); continue; }
    badResults.push(`${label}: HTTP ${r.status}${r.status === 400 ? " ✓" : " ✗"}`);
    if (r.status !== 400) bugs.push(`/api/analyze accepted bad input "${label}" with HTTP ${r.status} (expected 400)`);
  }

  // ── Distinct plans ──
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(r.plan, [...(groups.get(r.plan) ?? []), r]);
  const shared = [...groups.entries()].filter(([, rs]) => rs.length > 1);
  const sharedPeople = shared.reduce((n, [, rs]) => n + rs.length, 0);

  // ── Sensitivity: flip one field; every invariant (incl. soft barriers + ranking) must still hold ──
  const minTravelInCatalog = Math.min(...ACTIVITIES.flatMap((a) => Object.values(a.travelMin) as number[]));
  type Mut = { label: string; f: (p: P) => P | null };
  const muts: Mut[] = [
    { label: "mobility→full", f: (p) => (p.mobility === "full" ? null : { ...p, mobility: "full" }) },
    { label: "mobility→cane", f: (p) => (p.mobility === "cane" ? null : { ...p, mobility: "cane" }) },
    { label: "mobility→wheelchair", f: (p) => (p.mobility === "wheelchair" ? null : { ...p, mobility: "wheelchair" }) },
    { label: "add drive", f: (p) => (p.transport.includes("drive") ? null : { ...p, transport: [...p.transport, "drive"] }) },
    { label: "remove family", f: (p) => (p.transport.includes("family") && p.transport.length > 1 ? { ...p, transport: p.transport.filter((m) => m !== "family") } : null) },
    { label: "all times", f: (p) => (p.times.length === 3 ? null : { ...p, times: ["morning", "afternoon", "evening"] }) },
    { label: "budget→$0", f: (p) => (p.budgetPerWeek === 0 ? null : { ...p, budgetPerWeek: 0 }) },
    { label: "budget→$500", f: (p) => (p.budgetPerWeek === 500 ? null : { ...p, budgetPerWeek: 500 }) },
    { label: "travel→5 min", f: (p) => (p.maxTravelMin === 5 ? null : { ...p, maxTravelMin: 5 }) },
    { label: "travel→120 min", f: (p) => (p.maxTravelMin === 120 ? null : { ...p, maxTravelMin: 120 }) },
    { label: "toggle hearingImpaired", f: (p) => ({ ...p, hearingImpaired: !p.hearingImpaired }) },
    { label: "toggle prefersSmallGroups", f: (p) => ({ ...p, prefersSmallGroups: !p.prefersSmallGroups }) },
  ];
  let mutRuns = 0, feasChanged = 0, planChanged = 0;
  const mutFails: string[] = [];
  const reorders: string[] = [];
  const perMut = new Map<string, { runs: number; feas: number; plan: number; soft: number }>();
  for (const per of people) {
    const p = per.profile;
    const base = runScenario({ profile: p });
    for (const m of muts) {
      const q = m.f(p);
      if (!q) continue;
      mutRuns++;
      const o = runScenario({ profile: q });
      const st = perMut.get(m.label) ?? { runs: 0, feas: 0, plan: 0, soft: 0 };
      st.runs++;
      const fc = !isDeepStrictEqual(oracleFeasible(p), oracleFeasible(q));
      const pc = sig(o) !== sig(base);
      if (fc) { feasChanged++; st.feas++; }
      if (pc) { planChanged++; st.plan++; }
      if (barrierSig(o) !== barrierSig(base)) st.soft++;
      perMut.set(m.label, st);
      for (const f of checkInvariants(q, o)) mutFails.push(`${per.id} ${m.label}: ${f}`);
      // Rules that force change, derived from the catalog:
      if (m.label === "budget→$0" && o.plan.some((i) => i.costPerWeek > 0)) mutFails.push(`${per.id} budget→$0: paid item still in plan`);
      if (m.label === "travel→5 min" && minTravelInCatalog > 5 && o.plan.length) mutFails.push(`${per.id} travel→5: plan not empty though the closest venue is ${minTravelInCatalog} min`);
      if (!base.plan.length && oracleFeasible(q).length && !o.plan.length) mutFails.push(`${per.id} ${m.label}: newly feasible activities but plan still empty`);
      // Plan moved without the feasible set moving: not filtered. The ranking oracle in checkInvariants must
      // reproduce it (else it's a failure above); the reason shown is derived from score/soft/route diffs.
      if (!fc && pc) reorders.push(`${per.id} ${p.name} ${m.label}: ${sig(base)} → ${sig(o)}${isDeepStrictEqual(base.plan.map((i) => i.activityId).sort(), o.plan.map((i) => i.activityId).sort()) ? " (same activities, new rank order)" : ""} — ${explainChange(p, q, base, o)}`);
    }
  }
  for (const f of mutFails) bugs.push(`sensitivity ${f}`);

  // ── Margaret → "Zed" (demo name must not drive output) ──
  const demoChecks: string[] = [];
  for (const [key, prof] of Object.entries(DEMO_PROFILES)) {
    const a = runScenario({ profile: prof }), b = runScenario({ profile: { ...prof, name: "Zed" } });
    const same = isDeepStrictEqual(planShape(a), planShape(b)) && isDeepStrictEqual(a.blocked.map((x) => x.name), b.blocked.map((x) => x.name));
    demoChecks.push(`${key} → "Zed": ${same ? "identical plan ✓" : "DIFFERENT ✗"} (${sig(a)})`);
    if (!same) bugs.push(`demo ${key}: plan keyed to name`);
    for (const f of checkInvariants(prof, a)) bugs.push(`demo ${key}: ${f}`);
  }

  // ── Coordination API: does the result depend on the person? Contract (COORDINATION_CONTRACT.md:9):
  //    coordination and /api/analyze "always agree on what's feasible", so analyze-feasible ⇒ not BLOCKED. ──
  const daughter = { id: "c-daughter", name: "Lena", relation: "daughter", canDrive: true };
  const friend = { id: "c-friend", name: "Ruth", relation: "friend", canDrive: false };
  type CoordCase = { who: string; activityId: string; contacts: Contact[]; expect: { state: string; blockerRule?: string; rideTo?: string | null; invite?: boolean } };
  const coordCases: CoordCase[] = [
    { who: "p25", activityId: "choir", contacts: [], expect: { state: "BLOCKED", blockerRule: "access" } }, // walker, stairs
    { who: "p02", activityId: "choir", contacts: [], expect: { state: "BLOCKED", blockerRule: "access" } }, // wheelchair, stairs
    { who: "p01", activityId: "choir", contacts: [], expect: { state: "PROPOSED", rideTo: null } }, // driver: same venue, no ride needed
    { who: "p06", activityId: "quilting", contacts: [daughter], expect: { state: "PROPOSED", rideTo: "c-daughter" } }, // family-only: ride from daughter
    { who: "p06", activityId: "quilting", contacts: [friend], expect: { state: "PROPOSED" } }, // contract: analyze says feasible ⇒ not BLOCKED
    { who: "p11", activityId: "dominoes", contacts: [], expect: { state: "PROPOSED", rideTo: "paratransit" } }, // paratransit-only
    { who: "p15", activityId: "concert", contacts: [friend], expect: { state: "PROPOSED", rideTo: null, invite: true } }, // small groups → invite
    { who: "p13", activityId: "fellowship", contacts: [], expect: { state: "PROPOSED" } }, // contract: analyze says feasible ⇒ not BLOCKED
  ];
  const disagreements: string[] = [];
  const coordRows: string[] = [];
  let coordPass = 0;
  for (const c of coordCases) {
    const prof = pp(c.who);
    const analyzeFeasible = oracleFeasible(prof).includes(c.activityId);
    const expectState = analyzeFeasible ? c.expect.state : "BLOCKED";
    if (expectState !== c.expect.state) throw new Error(`coord case ${c.who}/${c.activityId}: expectation contradicts the contract`);
    const r = await post("/api/coordination/plans", { profile: prof, activityId: c.activityId, contacts: c.contacts });
    if (!r) {
      coordRows.push(`| ${prof.name} | ${c.activityId} | ${analyzeFeasible ? "feasible" : "blocked"} | SKIPPED | | | ✗ not run |`);
      incomplete.push(`coordination ${prof.name}/${c.activityId} not checked (API unreachable)`);
      continue;
    }
    const plan = (r.json as Partial<CommandResult>).plan;
    const rides = (plan?.actions ?? []).filter((a) => a.scope.kind === "ride" && a.status !== "superseded");
    const invites = (plan?.actions ?? []).filter((a) => a.scope.kind === "invite");
    const rideTo = rides[0]?.scope.recipientId ?? null;
    const errs: string[] = [];
    const inAnalyzePlan = runScenario({ profile: prof }).plan.some((i) => i.activityId === c.activityId);
    if (analyzeFeasible === (plan?.state === "BLOCKED")) {
      disagreements.push(`${prof.name} (${prof.transport.join("/")}) + ${c.activityId}, contacts=${JSON.stringify(c.contacts.map((x) => ({ id: x.id, canDrive: x.canDrive })))}: /api/analyze marks it ${analyzeFeasible ? "feasible" : "blocked"}${inAnalyzePlan ? " and PUTS IT IN THE WEEKLY PLAN" : ""}; /api/coordination/plans returns ${plan?.state} (${(plan?.blockers ?? []).map((b) => b.detail).join("; ")})`);
      errs.push("CONTRACT BREAK: disagrees with /api/analyze");
    }
    if (r.status !== 200) errs.push(`HTTP ${r.status}`);
    if (plan?.state !== c.expect.state) errs.push(`state ${plan?.state} ≠ ${c.expect.state}`);
    if (c.expect.blockerRule && !(plan?.blockers ?? []).some((b) => b.rule === c.expect.blockerRule)) errs.push(`no ${c.expect.blockerRule} blocker`);
    if (c.expect.rideTo !== undefined && rideTo !== c.expect.rideTo) errs.push(`ride to ${rideTo} ≠ ${c.expect.rideTo}`);
    if (c.expect.invite && !invites.length) errs.push("no invite action");
    if (plan?.dataSource !== "mock") errs.push(`coordination dataSource=${plan?.dataSource}`);
    if (!errs.length) coordPass++;
    coordRows.push(`| ${prof.name} (${prof.mobility}, ${prof.transport.join("/")}) | ${c.activityId} | ${c.contacts.map((x) => `${x.id}${x.canDrive ? " (drives)" : ""}`).join(", ") || "none"} | ${analyzeFeasible ? "feasible" : "blocked"} | ${c.expect.state} | ${plan?.state ?? "?"} | ${(plan?.blockers ?? []).map((b) => b.rule).join(", ") || "—"} | ${rides.length ? `ride → ${rideTo}` : "no ride"}${invites.length ? `, invite → ${invites[0].scope.recipientId}` : ""} | ${errs.length ? `✗ ${errs.join("; ")}` : "✓"} |`);
    if (errs.length) bugs.push(`coordination ${prof.name}/${c.activityId}: ${errs.join("; ")}`);
  }

  // ── Report ──
  const hardViol = rows.reduce((n, r) => n + r.fails.filter((f) => f.startsWith("HARD")).length, 0);
  const softViol = rows.reduce((n, r) => n + r.fails.filter((f) => f.startsWith("SOFT")).length, 0) + mutFails.filter((f) => f.includes("SOFT")).length;
  const passCount = rows.filter((r) => !r.fails.length).length;
  const apiMatch = rows.filter((r) => r.api === "match").length;
  const emptyPlans = rows.filter((r) => r.plan === "(empty)").length;
  const tieRows = rows.filter((r) => r.tie);
  const ok = !bugs.length && !incomplete.length;
  const flagCombos = new Map<string, string[]>();
  for (const per of people) { const k = `${per.profile.hearingImpaired ? "hearing" : "-"}/${per.profile.prefersSmallGroups ? "small-groups" : "-"}`; flagCombos.set(k, [...(flagCombos.get(k) ?? []), per.id]); }
  const lines: string[] = [];
  lines.push("# DayBridge synthetic people bake", "");
  lines.push(`Generated by \`npx tsx evals/bake/run.ts\` on ${new Date().toISOString().slice(0, 10)} against the real engine (\`src/domain/engine.ts\`) and the dev API at ${BASE}. Exit code ${ok ? 0 : 1}.`, "");
  lines.push("## Summary", "");
  if (incomplete.length) lines.push(`> **INCOMPLETE RUN: ${incomplete.length} checks did not run** (${apiUp ? "skipped" : `API unreachable at ${BASE}`}). The numbers below only cover what ran. Exit code 1.`, "");
  lines.push(`**${rows.length} synthetic people, ${groups.size} distinct weekly plans, ${hardViol} hard-constraint violations, ${softViol} soft-barrier mismatches, ${passCount}/${rows.length} pass every per-person invariant${apiUp ? "" : " (API checks did not run, so none count as passed)"}. ${bugs.length} failing checks overall${disagreements.length ? ` (${disagreements.length} are the analyze-vs-coordination contract break below)` : ""}${incomplete.length ? `, ${incomplete.length} checks not run` : ""}.**`, "");
  lines.push(`- API \`/api/analyze\` returned exactly the engine's output for ${apiMatch}/${rows.length} people. Explanation source: ${[...dataSources].join(", ") || "n/a"}; labeled honestly for ${honestCount}/${apiResponses} responses${apiResponses < rows.length ? ` (${rows.length - apiResponses} people got no response)` : ""}.`);
  lines.push(`- Deterministic for ${rows.filter((r) => r.det).length}/${rows.length}; order-independent for ${rows.filter((r) => r.perm).length}/${rows.length}; name-independent for ${rows.filter((r) => r.rename).length}/${rows.length} (+ ${demoChecks.length} demo profiles renamed to "Zed").`);
  lines.push(`- Ranking: every plan (base and mutated) equals an independently recomputed greedy plan (score = 10 × matching interests − 2 × soft barriers − travel/10). ${tieRows.length} of ${rows.length} base plans are decided by an equal-score tie broken by activity id: ${tieRows.map((r) => r.name).join(", ") || "none"}.`);
  lines.push(`- Sensitivity: ${mutRuns} single-field flips across ${muts.length} kinds. ${feasChanged} changed what is feasible, ${planChanged} changed the plan; ${mutFails.length} invariant failures after mutation.`);
  lines.push(`- ${emptyPlans} people get an empty plan, each for a real hard reason shown in the table (that's the engine refusing, not failing).`);
  lines.push(`- ${sharedPeople} people share a plan with someone else across ${shared.length} groups; reasons below.`);
  const coordSkipped = coordRows.filter((r) => r.includes("SKIPPED")).length;
  lines.push(`- Coordination API: ${coordPass}/${coordCases.length} person-dependent cases pass${disagreements.length ? `; ${disagreements.length} fail as the analyze-vs-coordination contract break (expected values come from the contract, not from current behavior)` : ""}${coordSkipped ? `; ${coordSkipped} did not run` : ""}.`);
  lines.push(`- Negative control: ${controlResults.filter((c) => c.includes("caught")).length}/${controlResults.length} planted violations caught by the specific check aimed at them (incl. dropped/mislabeled soft barriers and a swapped-in lower-ranked activity).`);
  lines.push(`- Bad input to /api/analyze: ${badResults.join("; ")}.`);
  lines.push(`- hearingImpaired/prefersSmallGroups combos in people.json: ${[...flagCombos].map(([k, v]) => `${k} ×${v.length}`).join(", ")}; both flags are also toggled on all 30 people in the sensitivity pass.`);
  if (schemaErrors.length) lines.push(`- Schema errors in people.json (people skipped): ${schemaErrors.join("; ")}`);
  if (incomplete.length) lines.push("", "### Checks that did not run", "", ...incomplete.map((s) => `- ${s}`));
  lines.push("", "## How each check works", "");
  lines.push("- **Hard constraints** are re-derived from `ACTIVITIES` by a separate oracle in run.ts (time slot, stairs vs walker/wheelchair, a mode the person has whose minutes are within their limit, cost). Every planned item, plus the plan's total cost, is checked against it. Walking only counts for full/cane mobility (the product's rule). The oracle never calls engine code.");
  lines.push("- **Soft barriers** on every planned item must equal the oracle's set exactly (cane + stairs, family-only or paratransit ride, noisy room without a hearing loop for a hearing-impaired person, large group for someone who prefers small groups), each with a mitigation. A dropped or mislabeled hearing/social barrier fails.");
  lines.push("- **Score + route + ranking**: each item's score and route must equal the recomputed ones, and the plan must equal the oracle's greedy plan (best score first, ties by id A→Z, one per day, ≤3, cumulative budget).");
  lines.push("- **Blocked**: every blocked activity has ≥1 hard barrier, every hard barrier is true per the oracle, no true reason is missing, and the blocked set equals the oracle's infeasible set.");
  lines.push("- **Maximal**: with fewer than 3 items, no feasible activity on a free day that fits the remaining budget was left out.");
  lines.push("- **Determinism / order / name**: same input twice, reversed arrays, and name→\"Zed\" all give the same plan.");
  lines.push(`- **Sensitivity** flips one field (mobility ×3, add drive, remove family, times, budget ×2, travel ×2, hearing, small groups) and re-runs every check above, plus forced-change rules: budget→$0 must leave no paid item; travel→5 min must give an EMPTY plan (asserted, because the closest venue in the catalog is ${minTravelInCatalog} min).`);
  lines.push("- **Exit code** is 0 only if every check ran and passed: an unreachable API, a skipped case, a schema-invalid person, bad input not rejected with 400, a contract break, or a missed negative control all exit 1.");
  lines.push("", "## Results", "");
  lines.push("| # | Person | Profile edge case | Interest matches | Feasible | Blocked | Plan (soft barriers) | $/wk | Tie decides? | API | Explanation | Invariants |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) lines.push(`| ${r.id} | ${r.name} | ${r.note} | ${r.relevant} | ${r.feasible} | ${r.blocked} | ${r.planNames} | $${r.spent} | ${r.tie ? "yes" : "no"} | ${r.api} | ${r.expl} | ${r.fails.length ? `✗ ${r.fails.join("; ")}` : "✓ pass"} |`);
  lines.push("", "## Distinct plans", "");
  lines.push(`${groups.size} distinct plan signatures across ${rows.length} people.`, "");
  for (const [s, rs] of shared) {
    const feasSets = new Set(rs.map((r) => oracleFeasible(pp(r.id)).join(",")));
    const why = s === "(empty)"
      ? "nothing feasible: " + rs.map((r) => {
          const p = pp(r.id);
          const reasons = new Set(relevant(p).flatMap((a) => hardReasons(p, a)));
          return `${r.name} (${[...reasons].join("/")})`;
        }).join(", ")
      : feasSets.size === 1 ? "identical feasible set, so the greedy ranking picks the same items" : "different feasible sets, but the same top-ranked items win on their days";
    lines.push(`- **${s}** × ${rs.length}: ${rs.map((r) => r.name).join(", ")}. Why: ${why}.`);
  }
  lines.push("", "## Sensitivity (one field flipped)", "", "| Flip | Runs | Feasible set changed | Plan changed | Plan scores/soft barriers changed |", "|---|---|---|---|---|");
  for (const [k, v] of perMut) lines.push(`| ${k} | ${v.runs} | ${v.feas} | ${v.plan} | ${v.soft} |`);
  if (mutFails.length) lines.push("", "Failures after mutation:", ...mutFails.map((f) => `- ${f}`));
  if (reorders.length) lines.push("", "Plan changed while the feasible set stayed the same. Not auto-accepted: the independent ranking oracle reproduced each one, and the reason is derived from the score/soft-barrier/route diff (TIE = an equal-score tie broken by id decided it):", ...reorders.map((f) => `- ${f}`));
  lines.push("", "## Demo names", "", ...demoChecks.map((d) => `- ${d}`));
  lines.push("", "## Coordination API (`POST /api/coordination/plans`)", "", "Expected states follow the contract: if /api/analyze says the activity is feasible, coordination must not return BLOCKED.", "", "| Person | Activity | Contacts | /api/analyze says | Expected | Coordination state | Blockers | Actions | Check |", "|---|---|---|---|---|---|---|---|---|", ...coordRows);
  lines.push("", "## Negative control", "", ...controlResults.map((c) => `- ${c}`));
  lines.push("", "## Engine bugs found", "", bugs.length ? bugs.map((b) => `- ${b}`).join("\n") : "None.");
  if (disagreements.length) lines.push("", "### Bug 1: analyze vs coordination disagree (contract says they \"always agree\")", "",
    "COORDINATION_CONTRACT.md:9 says hard barriers come from the same `checkActivity`, \"so /api/analyze and coordination always agree on what's feasible\". They don't when the only route is a family ride and the person has no contact with `canDrive: true`: the engine treats family as a soft barrier (feasible, mitigated by asking family), while the coordination planner hardens it to BLOCKED. /api/analyze takes no contacts, so it can't know. Adding a contact with `canDrive: true` turns the same case PROPOSED. Repro (dev server running):", "",
    ...disagreements.map((d) => `- ${d}`), "",
    "```bash", `curl -s -X POST ${BASE}/api/analyze -H 'content-type: application/json' -d '{"profile":${JSON.stringify(pp("p13"))}}' | jq '.plan[].activityId'   # includes "fellowship"`,
    `curl -s -X POST ${BASE}/api/coordination/plans -H 'content-type: application/json' -d '{"profile":${JSON.stringify(pp("p13"))},"activityId":"fellowship","contacts":[]}' | jq '.plan.state, .plan.blockers'   # "BLOCKED"`, "```", "",
    "Not fixed (engine is owned by lead/Opus). Either the code or the contract must change: pass contacts to /api/analyze, label family-only items in the weekly plan \"needs a driver\" until a contact with canDrive exists, or reword the contract line. Until then this bake exits 1.");
  lines.push("", "## Observations (product behavior, not bugs)", "", NOTES);
  writeFileSync(join(HERE, "REPORT.md"), lines.join("\n") + "\n");

  console.log(lines.slice(0, 22).join("\n"));
  console.log(controlResults.join("\n"));
  console.log(`\nincomplete: ${incomplete.length ? "\n" + incomplete.join("\n") : "none"}`);
  console.log(`bugs: ${bugs.length ? "\n" + bugs.join("\n") : "none"}`);
  process.exitCode = ok ? 0 : 1;
}

const NOTES = `- Walker and wheelchair users never get a "walk" route, so a walker user whose only mode is walk (Clara) gets nothing. That's the intended rule, but the profile form still lets them pick walk only.
- The plan allows one activity per day, so two feasible activities on the same day can't both be planned even at different times (e.g. Lakeside Morning Walkers, Mon morning, and Ukulele & Singing, Mon afternoon).
- Scoring is 10 × matching interests − 2 × soft barriers − travel/10, so people with many interests converge on the two-tag, close-by venues (Library Cards + Tech Hour); see "Distinct plans" for who shares what.
- Equal scores are broken by activity id alphabetically. That is deterministic but arbitrary; the "Tie decides?" column and the TIE notes show where it picks the plan.
- When family and another mode both fit, the engine prefers the independent mode even if family is faster (by design: "prefer an independent route").`;

main().catch((e) => { console.error(e); process.exitCode = 1; });
