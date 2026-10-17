import { CaregiverError } from "./access";
import type { CheckIn, CheckInInput, PlanLink, Person } from "./contract";

// Pure check-in construction. A check-in is a report only: it NEVER touches the coordinator
// (no approve, no complete, no attendance).
export function buildCheckIn(args: {
  person: Person;
  callerId: string;
  input: CheckInInput;
  links: PlanLink[];
  source: CheckIn["source"];
  now: Date;
  newId: () => string;
}): CheckIn {
  const { person, callerId, input, links } = args;
  if (input.planId && !links.some((l) => l.planId === input.planId && l.personId === person.personId))
    throw new CaregiverError(400, "planId is not one of this person's plans");
  return {
    checkInId: args.newId(),
    personId: person.personId,
    kind: input.kind,
    ...(input.planId ? { planId: input.planId } : {}),
    ...(input.note ? { note: input.note } : {}),
    reporterUserId: callerId,
    reporterRole: person.selfUserId === callerId ? "self" : "caregiver",
    source: args.source,
    at: args.now.toISOString(),
    idempotencyKey: input.idempotencyKey,
  };
}
