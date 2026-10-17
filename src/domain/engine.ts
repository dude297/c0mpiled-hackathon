import { ACTIVITIES, type Activity } from "@/domain/activities";
import type { Barrier, Evidence, PlanItem, Profile, ScenarioInput } from "@/lib/schema";

// Deterministic, correctness-critical logic lives in src/domain. No AI calls here.

export type DomainOutput = {
  summary: string;
  items: { label: string; value: string }[];
  plan: PlanItem[];
  blocked: { name: string; barriers: Barrier[] }[];
  evidence: Evidence[];
};

const MAX_PLAN = 3;

type Check = { rule: string; ok: boolean; detail: string; barrier?: Barrier };

function bestRoute(p: Profile, a: Activity) {
  const canWalk = p.mobility === "full" || p.mobility === "cane";
  const routes = p.transport
    .filter((m) => m !== "walk" || canWalk)
    .flatMap((m) => (a.travelMin[m] === undefined ? [] : [{ mode: m, min: a.travelMin[m]! }]))
    .sort((x, y) => x.min - y.min || x.mode.localeCompare(y.mode));
  // Prefer an independent route over relying on family when both fit the travel limit.
  const fitting = routes.filter((r) => r.min <= p.maxTravelMin);
  return fitting.find((r) => r.mode !== "family") ?? fitting[0] ?? routes[0];
}

export function checkActivity(p: Profile, a: Activity): Check[] {
  const checks: Check[] = [];
  const hard = (rule: string, detail: string): Check => ({ rule, ok: false, detail, barrier: { rule, severity: "hard", detail } });
  const soft = (rule: string, detail: string, mitigation: string): Check => ({ rule, ok: true, detail, barrier: { rule, severity: "soft", detail, mitigation } });
  const pass = (rule: string, detail: string): Check => ({ rule, ok: true, detail });

  checks.push(
    p.times.includes(a.time)
      ? pass("time", `Meets ${a.day} ${a.time}, when ${p.name} is available`)
      : hard("time", `Meets ${a.day} ${a.time}; ${p.name} is only available ${p.times.join("/")}`),
  );

  if (a.stepFree) checks.push(pass("access", "Step-free entrance"));
  else if (p.mobility === "walker" || p.mobility === "wheelchair") checks.push(hard("access", `Entrance has stairs; ${p.name} uses a ${p.mobility}`));
  else if (p.mobility === "cane") checks.push(soft("access", "Entrance has a few stairs", "Call ahead to ask about the side entrance and handrail"));
  else checks.push(pass("access", "Stairs at entrance, no mobility limits"));

  const route = bestRoute(p, a);
  if (!route) checks.push(hard("transport", `No way to get there using ${p.transport.join("/")}`));
  else if (route.min > p.maxTravelMin) checks.push(hard("transport", `Fastest option is ${route.mode} at ${route.min} min; limit is ${p.maxTravelMin} min`));
  else if (route.mode === "family") checks.push(soft("transport", `Only reachable by a family ride (${route.min} min)`, "Ask family to cover this weekly slot and set a recurring reminder"));
  else if (route.mode === "paratransit") checks.push(soft("transport", `Paratransit, ${route.min} min`, "Book the ride 24 hours ahead"));
  else checks.push(pass("transport", `${route.mode}, ${route.min} min`));

  checks.push(
    a.costPerWeek <= p.budgetPerWeek
      ? pass("cost", `$${a.costPerWeek}/week fits the $${p.budgetPerWeek} budget`)
      : hard("cost", `$${a.costPerWeek}/week exceeds the $${p.budgetPerWeek} budget`),
  );

  if (p.hearingImpaired && a.noisy && !a.hearingLoop) checks.push(soft("hearing", "Noisy room, no hearing loop", "Sit near the leader and ask for a quieter table"));
  else if (p.hearingImpaired) checks.push(pass("hearing", a.hearingLoop ? "Hearing loop available" : "Quiet setting"));

  if (p.prefersSmallGroups && a.groupSize === "large") checks.push(soft("social", "Large group; prefers small groups", "Bring a friend for the first visit"));

  return checks;
}

export function runScenario({ profile: p }: ScenarioInput): DomainOutput {
  const relevant = ACTIVITIES.filter((a) => a.tags.some((t) => p.interests.includes(t)));
  const assessed = relevant.map((a) => {
    const checks = checkActivity(p, a);
    const barriers = checks.flatMap((c) => (c.barrier ? [c.barrier] : []));
    const matches = a.tags.filter((t) => p.interests.includes(t)).length;
    const route = bestRoute(p, a);
    const softCount = barriers.filter((b) => b.severity === "soft").length;
    const score = Math.round((10 * matches - 2 * softCount - (route?.min ?? 0) / 10) * 10) / 10;
    return { a, checks, barriers, feasible: checks.every((c) => c.ok), score, route };
  });

  // Greedy weekly plan: highest score first, one activity per day, cumulative cost within budget.
  const plan: PlanItem[] = [];
  const usedDays = new Set<string>();
  let spent = 0;
  const ranked = assessed.filter((x) => x.feasible).sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
  for (const x of ranked) {
    if (plan.length >= MAX_PLAN || usedDays.has(x.a.day) || spent + x.a.costPerWeek > p.budgetPerWeek) continue;
    usedDays.add(x.a.day);
    spent += x.a.costPerWeek;
    plan.push({
      activityId: x.a.id,
      name: x.a.name,
      when: `${x.a.day} ${x.a.time}`,
      travel: `${x.route!.mode}, ${x.route!.min} min`,
      costPerWeek: x.a.costPerWeek,
      score: x.score,
      barriers: x.barriers,
    });
  }

  const blocked = assessed
    .filter((x) => !x.feasible)
    .map((x) => ({ name: x.a.name, barriers: x.barriers.filter((b) => b.severity === "hard") }));

  const planIds = new Set(plan.map((i) => i.activityId));
  // verified = the check passed; failed checks show why an activity was blocked.
  const evidence: Evidence[] = assessed.flatMap((x) =>
    x.checks
      .filter((c) => planIds.has(x.a.id) || !c.ok)
      .map((c) => ({ claim: `${x.a.name}: ${c.detail}`, source: `activity:${x.a.id}/rule:${c.rule}`, verified: c.ok })),
  );

  const mitigations = plan.reduce((n, i) => n + i.barriers.length, 0);
  return {
    summary: plan.length
      ? `${plan.length} activit${plan.length === 1 ? "y" : "ies"} ${p.name} can actually attend this week.`
      : `No activity fits ${p.name}'s constraints yet. See what's blocking each one.`,
    items: [
      { label: "Matching interests", value: String(relevant.length) },
      { label: "Feasible", value: String(ranked.length) },
      { label: "Blocked", value: String(blocked.length) },
      { label: "Weekly cost", value: `$${spent}` },
      { label: "Barriers to work around", value: String(mitigations) },
    ],
    plan,
    blocked,
    evidence,
  };
}
