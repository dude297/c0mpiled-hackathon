import { CaregiverError } from "@/domain/caregiver/access";
import { DecideInput, ProposalStatus, ProposeInput, RevertInput, type ProfileProposal } from "@/domain/caregiver/contract";
import { changesFromFeedback, currentVersion, effectiveChanges, pageVersions, profileAccess, type ProfileAction } from "@/domain/caregiver/profiles";
import { CoordinationError } from "@/domain/coordination/coordinator";
import { coordinator } from "../../../../coordination/_lib/service";
import { body, ports, reply } from "../../../_lib/service";

// Person profile endpoints. Proposals never touch the profile; only confirm/revert append a version.

async function access(personId: string, userId: string, action: ProfileAction) {
  const [person, grant] = await Promise.all([ports.store.getPerson(personId), ports.store.getGrant(personId, userId)]);
  return profileAccess(person, grant, userId, action);
}

const STALE = "Profile changed since this was proposed; review the current profile and propose again";

export async function getProfile(userId: string, personId: string) {
  const { person } = await access(personId, userId, "read");
  return reply({ profile: person.profile, version: currentVersion(person) });
}

export async function listVersions(userId: string, personId: string, url: URL) {
  await access(personId, userId, "read");
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1) throw new CaregiverError(400, "limit must be a positive integer");
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : Number(rawCursor);
  if (cursor !== null && (!Number.isInteger(cursor) || cursor < 1)) throw new CaregiverError(400, "Invalid cursor");
  return reply(pageVersions(await ports.store.listVersions(personId), limit, cursor));
}

export async function listProposals(userId: string, personId: string, url: URL) {
  await access(personId, userId, "read");
  const status = url.searchParams.get("status");
  if (status !== null && !ProposalStatus.safeParse(status).success) throw new CaregiverError(400, "Invalid status");
  const all = await ports.store.listProposals(personId);
  return reply({ proposals: all.filter((p) => status === null || p.status === status).reverse() });
}

export async function propose(userId: string, personId: string, req: Request) {
  const { person, isSelf } = await access(personId, userId, "propose");
  const input = await body(req, ProposeInput);
  if (input.source === "self" && !isSelf) throw new CaregiverError(400, 'source "self" is only for the person themselves');
  const changes = effectiveChanges(person.profile, input.changes);
  if (Object.keys(changes).length === 0) throw new CaregiverError(400, "changes match the current profile");
  const proposal: ProfileProposal = {
    proposalId: crypto.randomUUID(), personId, baseVersion: input.baseVersion, changes, evidence: input.evidence,
    source: isSelf ? "self" : (input.source ?? "caregiver"), proposedBy: userId, status: "proposed", createdAt: new Date().toISOString(),
  };
  const res = await ports.store.createProposal(proposal);
  if (res === "not_found") throw new CaregiverError(404, "Person not found");
  if (res === "stale") throw new CaregiverError(409, `baseVersion ${input.baseVersion} is not the current version`);
  return reply({ proposal: res }, 201);
}

export async function decide(userId: string, personId: string, proposalId: string, req: Request, decision: "confirmed" | "rejected") {
  await access(personId, userId, "decide");
  const expectedVersion = decision === "confirmed" ? (await body(req, DecideInput)).expectedVersion : undefined;
  const res = await ports.store.decideProposal({ personId, proposalId, decision, expectedVersion, decidedBy: userId, at: new Date().toISOString() });
  if (res === "not_found") throw new CaregiverError(404, "Proposal not found");
  if (res === "not_pending") throw new CaregiverError(409, "Proposal was already decided");
  if (res === "stale") return reply({ error: STALE, status: "stale" }, 409);
  if (res === "version_conflict") throw new CaregiverError(409, "expectedVersion is not the current version");
  return reply({ proposal: res.proposal, ...(res.version ? { version: res.version.version, profile: res.version.profile } : {}) });
}

export async function revert(userId: string, personId: string, req: Request) {
  await access(personId, userId, "revert");
  const input = await body(req, RevertInput);
  const target = (await ports.store.listVersions(personId)).find((v) => v.version === input.toVersion);
  if (!target) throw new CaregiverError(404, "Version not found");
  const res = await ports.store.appendVersion({
    personId, expectedVersion: input.expectedVersion, profile: target.profile, source: "revert", createdBy: userId, at: new Date().toISOString(),
  });
  if (res === "not_found") throw new CaregiverError(404, "Person not found");
  if (res === "stale") throw new CaregiverError(409, "expectedVersion is not the current version");
  return reply({ version: res.version, profile: res.profile, revertedTo: input.toVersion }, 201);
}

/** Linked COMPLETED plan's proposed feedback patches → one person-level proposal. Never confirms, never touches the plan. */
export async function feedbackProposals(userId: string, personId: string, planId: string) {
  const { person, scopes } = await access(personId, userId, "propose");
  if (!scopes.includes("manage") && !scopes.includes("checkin")) throw new CaregiverError(403, 'Requires the "manage" or "checkin" scope');
  const link = await ports.store.getPlanLink(planId);
  if (!link || link.personId !== personId) throw new CaregiverError(404, "Plan not found");
  let plan;
  try {
    plan = (await coordinator.get(planId)).plan;
  } catch (err) {
    if (err instanceof CoordinationError) throw new CaregiverError(404, "Plan not found");
    throw err;
  }
  if (plan.state !== "COMPLETED") throw new CaregiverError(409, "Feedback can be imported only from a completed plan");
  const existing = (await ports.store.listProposals(personId)).find((p) => p.planId === planId && p.status === "proposed");
  if (existing) return reply({ proposals: [existing], duplicate: true });
  const { changes, evidence } = changesFromFeedback(person.profile, plan);
  if (Object.keys(changes).length === 0) return reply({ proposals: [] });
  const proposal: ProfileProposal = {
    proposalId: crypto.randomUUID(), personId, baseVersion: currentVersion(person), changes, evidence: evidence || "From activity feedback",
    source: "feedback", proposedBy: userId, planId, status: "proposed", createdAt: new Date().toISOString(),
  };
  const res = await ports.store.createProposal(proposal);
  if (res === "not_found") throw new CaregiverError(404, "Person not found");
  if (res === "stale") throw new CaregiverError(409, "Profile changed while importing; try again");
  return reply({ proposals: [res] }, 201);
}
