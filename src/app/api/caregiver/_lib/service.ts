import type { z } from "zod";
import { CaregiverError, decideAccess, type Need } from "@/domain/caregiver/access";
import { attentionFor } from "@/domain/caregiver/attention";
import { buildCheckIn } from "@/domain/caregiver/checkins";
import {
  CheckInInput, CreatePersonInput, CreatePersonPlanInput, GrantInput,
  type CheckIn, type Grant, type Labels, type Person, type PersonSummary, type Scope,
} from "@/domain/caregiver/contract";
import { seedFixtures } from "@/domain/caregiver/fixtures";
import { checkInView, decodeCursor, MAX_HISTORY_LIMIT, paginate, planSummary, projectCheckins, projectEvents } from "@/domain/caregiver/history";
import { memoryCaregiverStore, type CaregiverStore } from "@/domain/caregiver/store";
import { upcomingFor } from "@/domain/caregiver/upcoming";
import { CoordinationError } from "@/domain/coordination/coordinator";
import type { CoordinationEvent, CoordinationPlan } from "@/lib/schema";
import { coordinator, demoEventsEnabled, parseBody } from "../../coordination/_lib/service";
import { headerCallerResolver, type CallerResolver } from "./caller";

// Swappable ports: the cloud lane replaces these with Supabase-backed implementations.
export const ports: { store: CaregiverStore; caller: CallerResolver } = { store: memoryCaregiverStore, caller: headerCallerResolver };

export const CAREGIVER_HOSTED_DISABLED = "Caregiver dashboard needs sign-in and storage; available in the local demo";

export const labels = (): Labels => ({ storage: ports.store.kind, providers: "simulated", generatedAt: new Date().toISOString() });
export const reply = (body: object, status = 200) => Response.json({ ...body, labels: labels() }, { status });

/** Hosted production without the local-demo flag fails closed (503) before identity is even read. */
export async function resolveCaller(req: Request): Promise<{ userId: string } | Response> {
  if (!demoEventsEnabled()) return reply({ error: CAREGIVER_HOSTED_DISABLED }, 503);
  const userId = await ports.caller.resolve(req);
  return userId ? { userId } : reply({ error: "Missing or invalid caller (x-daybridge-user)" }, 401);
}

export async function withCaller(req: Request, fn: (userId: string) => Promise<Response>): Promise<Response> {
  const caller = await resolveCaller(req);
  if (caller instanceof Response) return caller;
  try {
    return await fn(caller.userId);
  } catch (err) {
    if (err instanceof CaregiverError || err instanceof CoordinationError) return reply({ error: err.message }, err.status);
    throw err;
  }
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const parsed = await parseBody(req, schema);
  if (parsed instanceof Response) throw new CaregiverError(400, ((await parsed.json()) as { error: string }).error);
  return parsed;
}

// ─── Reads ───
async function access(personId: string, userId: string, need: Need) {
  const store = ports.store;
  const [person, grant] = await Promise.all([store.getPerson(personId), store.getGrant(personId, userId)]);
  return decideAccess(person, grant, userId, need);
}

async function loadPlans(personId: string): Promise<{ plan: CoordinationPlan; events: CoordinationEvent[] }[]> {
  const links = await ports.store.listPlanLinks(personId);
  const out = [];
  for (const l of links) {
    try {
      out.push(await coordinator.get(l.planId)); // await: a durable coordinator may be async
    } catch (err) {
      if (!(err instanceof CoordinationError)) throw err; // plan lost (e.g. restart): unknown stays unknown, skip it
    }
  }
  return out;
}

async function derive(person: Person, userId: string, now = new Date()) {
  const [loaded, checkIns, acked] = await Promise.all([
    loadPlans(person.personId),
    ports.store.listCheckins(person.personId),
    ports.store.listAckedItemIds(person.personId, userId),
  ]);
  const plans = loaded.map((x) => x.plan);
  return {
    loaded, plans, checkIns,
    upcoming: upcomingFor(plans, person.timezone, now),
    attention: attentionFor({ person, plans, checkIns, ackedItemIds: acked, now }),
  };
}

const latest = (c: CheckIn | undefined) => (c ? { kind: c.kind, at: c.at, reporterRole: c.reporterRole } : null);

export async function overview(userId: string) {
  const grants = (await ports.store.listGrantsForUser(userId)).filter((g) => g.scopes.includes("view"));
  const people: PersonSummary[] = [];
  for (const g of grants) {
    const person = await ports.store.getPerson(g.personId);
    if (!person) continue;
    const d = await derive(person, userId);
    people.push({
      personId: person.personId, displayName: person.profile.name, timezone: person.timezone,
      nextActivity: d.upcoming[0] ?? null, attentionCount: d.attention.length, latestCheckIn: latest(d.checkIns.at(-1)), myScopes: g.scopes,
    });
  }
  people.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.personId.localeCompare(b.personId));
  return reply({ people });
}

export async function personDetail(userId: string, personId: string) {
  const { person, scopes } = await access(personId, userId, "view");
  const d = await derive(person, userId);
  return reply({
    person,
    plans: d.plans.map(planSummary),
    upcoming: d.upcoming,
    attention: d.attention,
    latestCheckIns: d.checkIns.slice(-5).reverse().map((c) => checkInView(c, userId, scopes)),
    myScopes: scopes,
  });
}

export async function history(userId: string, personId: string, url: URL) {
  const { person, scopes } = await access(personId, userId, "view");
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1) throw new CaregiverError(400, "limit must be a positive integer");
  const rawCursor = url.searchParams.get("cursor");
  const after = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !after) throw new CaregiverError(400, "Invalid cursor");
  const d = await derive(person, userId);
  const items = [...d.loaded.flatMap((x) => projectEvents(x.plan.id, x.events)), ...projectCheckins(d.checkIns, userId, scopes)];
  return reply(paginate(items, Math.min(limit, MAX_HISTORY_LIMIT), after));
}

// ─── Writes ───
export async function createPerson(userId: string, req: Request) {
  const input = await body(req, CreatePersonInput);
  const at = new Date().toISOString();
  const person: Person = {
    personId: crypto.randomUUID(), profile: input.profile, timezone: input.timezone,
    ...(input.selfUserId ? { selfUserId: input.selfUserId } : {}),
    checkInSchedule: input.checkInSchedule ?? null, createdAt: at, createdBy: userId,
  };
  await ports.store.createPerson(person, { personId: person.personId, userId, scopes: ["view", "checkin", "manage"], grantedBy: userId, grantedAt: at });
  return reply(person, 201);
}

export async function listGrants(userId: string, personId: string) {
  await access(personId, userId, "manage");
  return reply({ grants: await ports.store.listGrants(personId) });
}

export async function upsertGrant(userId: string, personId: string, req: Request) {
  await access(personId, userId, "manage");
  const input = await body(req, GrantInput);
  const grant: Grant = { personId, userId: input.userId, scopes: input.scopes as Scope[], grantedBy: userId, grantedAt: new Date().toISOString() };
  const res = await ports.store.upsertGrant(grant);
  if (res === "last_manager") throw new CaregiverError(409, "Cannot remove the last manager");
  return reply(res, 201);
}

export async function revokeGrant(userId: string, personId: string, target: string) {
  await access(personId, userId, "manage");
  const res = await ports.store.revokeGrant(personId, target, new Date().toISOString());
  if (res === "not_found") throw new CaregiverError(404, "Grant not found");
  if (res === "last_manager") throw new CaregiverError(409, "Cannot revoke the last manager");
  return new Response(null, { status: 204 });
}

/** The ONLY way a plan becomes associated with a person: it is created here from the person's CURRENT profile (version recorded on the link). */
export async function createPlan(userId: string, personId: string, req: Request) {
  const { person } = await access(personId, userId, "manage");
  const input = await body(req, CreatePersonPlanInput);
  const res = await coordinator.create({ profile: person.profile, activityId: input.activityId, contacts: input.contacts });
  const linked = await ports.store.linkPlan({ personId, planId: res.plan.id, linkedAt: new Date().toISOString(), linkedBy: userId, profileVersion: person.profileVersion ?? 1 });
  if (linked !== "ok") throw new CaregiverError(409, "Plan is already linked to a person");
  return reply({ planId: res.plan.id, state: res.plan.state, profileVersion: person.profileVersion ?? 1 }, 201);
}

export async function checkIn(userId: string, personId: string, req: Request) {
  const { person } = await access(personId, userId, "checkin_or_self");
  const input = await body(req, CheckInInput);
  const links = await ports.store.listPlanLinks(personId);
  const c = buildCheckIn({ person, callerId: userId, input, links, source: "app", now: new Date(), newId: () => crypto.randomUUID() });
  const res = await ports.store.recordCheckin(c);
  if (res.conflict) throw new CaregiverError(409, "Idempotency key was already used with a different check-in");
  return reply({ checkIn: res.checkIn, duplicate: res.duplicate }, res.duplicate ? 200 : 201);
}

const PLAN_ITEM = /^(?:approval_needed|confirmation_pending|plan_disrupted):(.+):v\d+$/;
const CHECKIN_ITEM = /^(?:help_requested|call_requested):(.+)$/;
const OVERDUE_ITEM = /^checkin_overdue:([0-9a-f-]{36}):/;

export async function ack(userId: string, itemId: string) {
  const store = ports.store;
  let personId: string | undefined;
  const plan = PLAN_ITEM.exec(itemId)?.[1];
  const checkInId = CHECKIN_ITEM.exec(itemId)?.[1];
  if (plan) personId = (await store.getPlanLink(plan))?.personId;
  else if (checkInId) personId = (await store.getCheckIn(checkInId))?.personId;
  else personId = OVERDUE_ITEM.exec(itemId)?.[1];
  const NOT_FOUND = new CaregiverError(404, "Attention item not found");
  if (!personId) throw NOT_FOUND;
  let person: Person;
  try {
    ({ person } = await access(personId, userId, "view"));
  } catch (err) {
    if (err instanceof CaregiverError && err.status === 404) throw NOT_FOUND;
    throw err;
  }
  const d = await derive(person, userId);
  if (!d.attention.some((i) => i.itemId === itemId)) throw NOT_FOUND;
  await store.ack({ itemId, personId, userId, at: new Date().toISOString() });
  return reply({ itemId, acknowledgedByMe: true });
}

export async function seedDemo() {
  if (!demoEventsEnabled()) return reply({ error: CAREGIVER_HOSTED_DISABLED }, 503);
  return reply(await seedFixtures({ store: ports.store, coordinator }), 201);
}
