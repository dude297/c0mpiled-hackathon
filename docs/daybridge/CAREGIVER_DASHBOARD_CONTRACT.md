# Caregiver Dashboard: API Contract (v1)

> **Status of this document:** derived from the frozen backend spec v1 (integration lead). The Status column on every table says whether each item is **PROPOSED** (spec only, not verified in code) or **IMPLEMENTED** (verified in code, with the branch named). Until a row says IMPLEMENTED, treat it as PROPOSED.
>
> Backend owner: `feat/caregiver-backend`. Contract types live in `src/domain/caregiver/contract.ts`, not in `src/lib/schema.ts`. UI owner: see `docs/handoffs/caregiver-dashboard-ui.md`.

The caregiver dashboard lets a caregiver see the people they support, what each person has coming up, what needs attention, and recent check-ins. It reuses the existing coordinator (`src/domain/coordination/coordinator.ts`, the `coordinator` singleton in `src/app/api/coordination/_lib/service.ts`). It adds no new plan state machine. It never approves, executes, completes or records attendance on a plan.

## 1. Ground rules

| Rule | Status |
|---|---|
| Every route is under `/api/caregiver`, speaks JSON, and requires a caller | PROPOSED |
| Only explicit **grants** give access. No access comes from a relationship, a contact entry or a share link | PROPOSED |
| A person the caller has no grant for returns **404, not 403**, so a caller can't learn the person exists | PROPOSED |
| Plans can only be created through `POST /people/:id/plans` (which calls `coordinator.create`). No endpoint links an existing `planId`. A plan belongs to exactly one person | PROPOSED |
| Check-ins and acknowledgements never change coordinator state (no approve, complete or attendance) | PROPOSED |
| Dependency status (`requested` vs `confirmed`) and `plan.outcome` (`attended`, `source: "self_reported"`) are reported separately and never merged | PROPOSED |
| Every response carries `labels: { storage, providers: "simulated", generatedAt }` | PROPOSED |
| Unknown stays unknown: a person with no `checkInSchedule` never gets an overdue item | PROPOSED |

## 2. Identity and availability

`resolveCaller(req) → { userId } | Response`. The verified-identity provider is a port (`CallerResolver`). The Supabase implementation comes later from the cloud lane (PR #23). The demo has no auth.

| Environment | Caller comes from | Missing/invalid caller | Status |
|---|---|---|---|
| Local/dev (`NODE_ENV !== "production"`), or local demo flag on (`demoEventsEnabled()`, i.e. `DAYBRIDGE_DEMO_EVENTS=1`) | Header `x-daybridge-user`, must match `^[a-z0-9-]{3,40}$` | **401** `{ "error": "..." }` | PROPOSED |
| Hosted production, flag off | not resolved | **503** `{ "error": "Caregiver dashboard needs sign-in and storage; available in the local demo" }` on every route | PROPOSED |

Storage is a port (`CaregiverStore`). The default is an in-memory store on `globalThis`, so `labels.storage = "memory"` and data is lost on restart. A durable (Supabase) store would report `"durable"`.

## 3. TypeScript types

These mirror the Zod schemas in `src/domain/caregiver/contract.ts`. Field names are normative. Exact optionality is PROPOSED until reconciled with the code.

```ts
// ---- shared ----
type ISODateTime = string;            // e.g. "2026-10-17T19:04:00.000Z"
type Scope = "view" | "checkin" | "manage";
type PlanState =                      // PlanState from src/lib/schema.ts:70, not redefined
  | "BLOCKED" | "PROPOSED" | "AWAITING_APPROVAL" | "PENDING_CONFIRMATION" | "READY"
  | "NEEDS_REPLAN" | "COMPLETED" | "CANCELLED";
type DependencyStatus =               // src/lib/schema.ts:117; "requested" is NOT "confirmed"
  | "not_requested" | "requested" | "confirmed" | "declined" | "cancelled" | "failed";

interface Labels {
  storage: "memory" | "durable";      // memory = lost on restart
  providers: "simulated";             // no real rides or invites are sent
  generatedAt: ISODateTime;
}

interface ErrorBody { error: string }

// ---- entities ----
interface Person {
  personId: string;                   // uuid
  profile: Profile;                   // existing Profile from src/lib/schema.ts
  timezone: string;                   // IANA, validated with Intl.DateTimeFormat
  selfUserId?: string;                // the person's own user id, if they use the app
  checkInSchedule: { everyDays: number /* 1..14 */ } | null;
  createdAt: ISODateTime;
  createdBy: string;
}

interface Grant {
  personId: string;
  userId: string;
  scopes: Scope[];                    // non-empty, deduped
  grantedBy: string;
  grantedAt: ISODateTime;
  revokedAt?: ISODateTime;
}

interface PlanLink { personId: string; planId: string; linkedAt: ISODateTime; linkedBy: string }

interface CheckIn {
  checkInId: string;
  personId: string;
  kind: "ok" | "call" | "help";
  planId?: string;                    // must be linked to this person
  note?: string;                      // 1..280 chars after trim; see visibility rule
  hasNote?: true;                     // set instead of `note` when the caller may not read it
  reporterUserId: string;
  reporterRole: "self" | "caregiver"; // "self" iff reporter === person.selfUserId
  source: "app" | "demo";
  at: ISODateTime;
  idempotencyKey: string;             // 1..80; never returned in history
}

interface Ack { itemId: string; personId: string; userId: string; at: ISODateTime }

// ---- derived ----
type AttentionKind =
  | "approval_needed" | "confirmation_pending" | "plan_disrupted"
  | "help_requested" | "call_requested" | "checkin_overdue";

interface AttentionItem {
  itemId: string;                     // stable, see section 6
  kind: AttentionKind;
  personId: string;
  planId?: string;
  title: string;
  detail: string;
  createdAt: ISODateTime;
  acknowledgedByMe: boolean;          // acknowledging never removes the item
}

interface Upcoming {
  planId: string;
  activityName: string;
  slot: string;                       // plan.when, e.g. "Sun afternoon"
  nextDate: string;                   // "YYYY-MM-DD", next occurrence in person's timezone; today counts
  timezone: string;
  state: PlanState;                   // never COMPLETED or CANCELLED here
}

interface PlanSummary {
  planId: string;
  activityName: string;
  when: string;
  state: PlanState;
  version: number;
  outstandingApprovals: { actionId: string; kind: string; description: string }[]; // no scope/approval payloads
  dependencies: { kind: string; label: string; status: DependencyStatus }[];
  outcome?: { attended: boolean; source: "self_reported" };
  updatedAt: ISODateTime;
}

interface PersonSummary {
  personId: string;
  displayName: string;                // profile.name
  timezone: string;
  nextActivity: Upcoming | null;
  attentionCount: number;
  latestCheckIn: { kind: CheckIn["kind"]; at: ISODateTime; reporterRole: CheckIn["reporterRole"] } | null;
  myScopes: Scope[];
}

interface HistoryItem {
  at: ISODateTime;
  type: "plan_state" | "dependency" | "attendance" | "feedback" | "checkin";
  planId?: string;
  summary: string;                    // e.g. "Ride: confirmed"
}

// ---- requests / responses ----
type OverviewResponse = { people: PersonSummary[]; labels: Labels };

type CreatePersonRequest = {
  profile: Profile; timezone: string; selfUserId?: string;
  checkInSchedule?: { everyDays: number } | null;
};
type CreatePersonResponse = Person & { labels: Labels };          // 201

type PersonDetailResponse = {
  person: Person;                     // includes profile
  plans: PlanSummary[];
  upcoming: Upcoming[];
  attention: AttentionItem[];
  latestCheckIns: CheckIn[];          // up to 5, newest first
  myScopes: Scope[];
  labels: Labels;
};

type UpsertGrantRequest = { userId: string; scopes: Scope[] };    // upsert replaces scopes
type UpsertGrantResponse = Grant & { labels: Labels };            // 201
type ListGrantsResponse = { grants: Grant[]; labels: Labels };    // active only

type CreatePlanRequest = { activityId: string; contacts?: Contact[] };
type CreatePlanResponse = { planId: string; state: PlanState; labels: Labels };  // 201

type CreateCheckInRequest = {
  kind: "ok" | "call" | "help"; planId?: string; note?: string; idempotencyKey: string;
};
type CreateCheckInResponse = { checkIn: CheckIn; duplicate: boolean; labels: Labels }; // 201 new, 200 duplicate

type AckResponse = { itemId: string; acknowledgedByMe: true; labels: Labels };

type HistoryResponse = { items: HistoryItem[]; nextCursor: string | null; labels: Labels };

type DemoSeedResponse = {
  users: { manager: "cg-dana"; viewer: "cg-lee"; self: "self-maya" };
  people: { maya: string; margaret: string };   // personIds (uuid, generated per seed)
  plans: { maya: string; margaret: string };    // planIds
  labels: Labels;
};
```

## 4. Endpoints

All paths are relative to `/api/caregiver`. All require the `x-daybridge-user` header (local/demo).

| Method | Path | Required scope | Success | Status |
|---|---|---|---|---|
| GET | `/overview` | `view` per person (others omitted) | 200 `OverviewResponse` | PROPOSED |
| POST | `/people` | any caller; caller becomes manager (all 3 scopes) | 201 `CreatePersonResponse` | PROPOSED |
| GET | `/people/:id` | `view` | 200 `PersonDetailResponse` | PROPOSED |
| POST | `/people/:id/grants` | `manage` | 201 `UpsertGrantResponse` | PROPOSED |
| GET | `/people/:id/grants` | `manage` | 200 `ListGrantsResponse` | PROPOSED |
| DELETE | `/people/:id/grants/:userId` | `manage` | 204; 409 if last active manager | PROPOSED |
| POST | `/people/:id/plans` | `manage` | 201 `CreatePlanResponse` (via `coordinator.create`) | PROPOSED |
| POST | `/people/:id/checkins` | `checkin`, or caller is `selfUserId` | 201 new / 200 duplicate | PROPOSED |
| POST | `/attention/:itemId/ack` | `view` on the item's person | 200 `AckResponse` | PROPOSED |
| GET | `/people/:id/history?limit=20&cursor=` | `view` | 200 `HistoryResponse` | PROPOSED |
| POST | `/demo` | dev or local-demo flag only | 200/201 `DemoSeedResponse` | PROPOSED |

### Examples

`GET /api/caregiver/overview` as `cg-dana` (after seeding):

```json
{
  "people": [
    {
      "personId": "6f1c2b9e-0000-4000-8000-00000000maya",
      "displayName": "Maya",
      "timezone": "America/Los_Angeles",
      "nextActivity": {
        "planId": "plan-maya-1", "activityName": "Fellowship lunch", "slot": "Sun afternoon",
        "nextDate": "2026-10-18", "timezone": "America/Los_Angeles", "state": "AWAITING_APPROVAL"
      },
      "attentionCount": 2,
      "latestCheckIn": { "kind": "ok", "at": "2026-10-13T17:00:00.000Z", "reporterRole": "caregiver" },
      "myScopes": ["view", "checkin", "manage"]
    },
    {
      "personId": "6f1c2b9e-0000-4000-8000-0000margaret",
      "displayName": "Margaret",
      "timezone": "America/New_York",
      "nextActivity": {
        "planId": "plan-margaret-1", "activityName": "Bridge club", "slot": "Tue afternoon",
        "nextDate": "2026-10-20", "timezone": "America/New_York", "state": "READY"
      },
      "attentionCount": 0,
      "latestCheckIn": null,
      "myScopes": ["view", "checkin", "manage"]
    }
  ],
  "labels": { "storage": "memory", "providers": "simulated", "generatedAt": "2026-10-17T19:04:00.000Z" }
}
```

The ids and activity names above are **illustrative**. Seeded ids are generated per seed and returned by `POST /demo`.

`POST /api/caregiver/people/:id/checkins`:

```json
// request
{ "kind": "call", "note": "Sounded tired, asked me to ring after lunch.", "idempotencyKey": "ui-7c1e" }
// 201 response
{
  "checkIn": {
    "checkInId": "ci-01", "personId": "6f1c...maya", "kind": "call",
    "note": "Sounded tired, asked me to ring after lunch.",
    "reporterUserId": "cg-dana", "reporterRole": "caregiver", "source": "app",
    "at": "2026-10-17T19:05:00.000Z", "idempotencyKey": "ui-7c1e"
  },
  "duplicate": false,
  "labels": { "storage": "memory", "providers": "simulated", "generatedAt": "2026-10-17T19:05:00.000Z" }
}
```

Sending the same `idempotencyKey` with the same body returns 200 and `"duplicate": true` with the original check-in. Sending the same key with a different body returns **409**.

`GET /api/caregiver/people/:id/history?limit=2`:

```json
{
  "items": [
    { "at": "2026-10-17T19:05:00.000Z", "type": "checkin", "summary": "Caregiver check-in: call" },
    { "at": "2026-10-17T18:58:00.000Z", "type": "plan_state", "planId": "plan-maya-1", "summary": "Plan: awaiting approval" }
  ],
  "nextCursor": "eyJhdCI6IjIwMjYtMTAtMTdUMTg6NTg6MDAuMDAwWiIsInNlcSI6M30=",
  "labels": { "storage": "memory", "providers": "simulated", "generatedAt": "2026-10-17T19:06:00.000Z" }
}
```

## 5. Permissions matrix

`self` means the caller equals `person.selfUserId` (no grant needed for check-ins).

| Action | view | checkin | manage | self (no grant) | No grant | Status |
|---|---|---|---|---|---|---|
| See person in overview | yes | only with view | yes (creator has all 3) | no | omitted | PROPOSED |
| GET person detail | yes | 403 without view | yes | 404 unless also granted | **404** | PROPOSED |
| GET history | yes | 403 without view | yes | 404 unless also granted | **404** | PROPOSED |
| Read check-in note text | own notes only | own notes only | **all** notes | own notes only | n/a | PROPOSED |
| POST check-in | 403 | yes (`reporterRole: "caregiver"`) | 403 unless also checkin* | yes (`reporterRole: "self"`) | **404** | PROPOSED |
| Ack attention item | yes | 403 without view | yes | 404 unless also granted | **404** | PROPOSED |
| Create plan | 403 | 403 | yes | 404 unless also granted | **404** | PROPOSED |
| Grant / list / revoke grants | 403 | 403 | yes (409 on last manager) | 404 unless also granted | **404** | PROPOSED |

\* Scopes are independent; the creator gets all three. A grant holding only `manage` has no implied `checkin` per the spec. Confirm against the code before relying on it.

Revocation takes effect on the next request: a revoked user's next call returns 404.

## 6. Derived data

### Attention items (recomputed on every read; ids are stable)

| `itemId` pattern | When | Status |
|---|---|---|
| `approval_needed:<planId>:v<version>` | Plan is AWAITING_APPROVAL, or NEEDS_REPLAN after accept with current actions `proposed`/`revoked` | PROPOSED |
| `confirmation_pending:<planId>:v<version>` | Plan is PENDING_CONFIRMATION; `detail` lists dependency labels still `requested` | PROPOSED |
| `plan_disrupted:<planId>:v<version>` | Plan is NEEDS_REPLAN | PROPOSED |
| `help_requested:<checkInId>` | A check-in with kind `help` | PROPOSED |
| `call_requested:<checkInId>` | The latest `call` check-in for the person, with no later `ok` from the same reporter role | PROPOSED |
| `checkin_overdue:<personId>:<windowStartISO>` | Only if `checkInSchedule` is set and the last check-in (or `createdAt`) is older than `everyDays` | PROPOSED |

Because the version is in the id, a plan that moves on (new version) yields a new item. An acknowledgement on the old id doesn't carry over.

### Upcoming

One entry per linked plan whose state is not COMPLETED or CANCELLED. `nextDate` is the next date of the plan's weekday in the person's timezone, counting today. Spec tests cover 23:30 vs 00:30 local across America/Los_Angeles, America/New_York and Pacific/Kiritimati, and a DST change. Status: PROPOSED.

### History

Newest first. `type` mapping (PROPOSED):

| Coordinator event | `type` | Example `summary` |
|---|---|---|
| `plan.ready`, `plan.ready_revoked`, `plan.replan_required` | `plan_state` | "Plan: ready" |
| `plan.completed` | `attendance` / `plan_state` | "Attended (self-reported)" |
| ride/invite requested, confirmed, cancelled | `dependency` | "Ride: confirmed" |
| `preference.updated` | `feedback` | "Preference updated: prefers small groups" |
| caregiver store check-in | `checkin` | "Self check-in: ok" |

Never included: approval payloads, scopes, `sharedFields`, `requestId`s, idempotency keys, provider data, contact ids or names, tokens, rejected/duplicate/ignored events.

## 7. Pagination

| Rule | Status |
|---|---|
| `limit` default 20, max 50 (values above 50 are clamped or rejected with 400; confirm against the code) | PROPOSED |
| `cursor` is opaque (base64 of `(at, seq)`). Clients pass back `nextCursor` unchanged and never parse it | PROPOSED |
| `nextCursor: null` means no more items | PROPOSED |
| A malformed cursor → 400 | PROPOSED |

## 8. Errors

Every error body is `{ "error": string }`. The message is safe to show.

| Status | Meaning | Status |
|---|---|---|
| 400 | Invalid body/query (bad Zod parse, note > 280, bad timezone, bad cursor) | PROPOSED |
| 401 | Missing or invalid `x-daybridge-user` | PROPOSED |
| 403 | Caller has a grant on the person but lacks the needed scope | PROPOSED |
| 404 | Unknown person, **or a person the caller has no grant for at all** (no existence leak), unknown item | PROPOSED |
| 409 | Revoking the last active manager; idempotency key reused with a different body | PROPOSED |
| 503 | Hosted production without the local-demo flag | PROPOSED |

## 9. Fixtures (`POST /api/caregiver/demo`, fictional)

| Fixture | Data | Status |
|---|---|---|
| `cg-dana` | Manager of Maya and Margaret | PROPOSED |
| `cg-lee` | `view` only on Margaret; can't see Maya (404) | PROPOSED |
| `self-maya` | Maya's `selfUserId` | PROPOSED |
| Maya | Fellowship plan, accepted, so AWAITING_APPROVAL. America/Los_Angeles. `everyDays: 3`. One caregiver `ok` check-in 4 days ago, so she is overdue | PROPOSED |
| Margaret | Bridge plan, READY (no dependencies). America/New_York. No schedule, so never overdue. No `selfUserId`, so no self check-ins | PROPOSED |

All names are fictional.

## 10. Reproducible curl walkthrough (local)

Run `npm run dev` first. The `jq` lines are optional.

```bash
B=http://localhost:3000/api/caregiver
H='content-type: application/json'

# 1. Seed fixtures; capture ids
SEED=$(curl -s -X POST $B/demo -H "x-daybridge-user: cg-dana")
MAYA=$(echo "$SEED" | jq -r .people.maya)
MARG=$(echo "$SEED" | jq -r .people.margaret)

# 2. Dana sees both; Lee sees only Margaret
curl -s $B/overview -H "x-daybridge-user: cg-dana" | jq '.people[].displayName'
curl -s $B/overview -H "x-daybridge-user: cg-lee"  | jq '.people[].displayName'

# 3. Isolation: Lee asking for Maya → 404 (not 403)
curl -s -o /dev/null -w '%{http_code}\n' $B/people/$MAYA -H "x-daybridge-user: cg-lee"

# 4. No caller → 401
curl -s -o /dev/null -w '%{http_code}\n' $B/overview

# 5. Maya's attention: approval_needed + checkin_overdue
curl -s $B/people/$MAYA -H "x-daybridge-user: cg-dana" | jq '.attention[].itemId'

# 6. Self check-in by Maya (reporterRole "self"), then a duplicate replay → 200 duplicate:true
curl -s -X POST $B/people/$MAYA/checkins -H "x-daybridge-user: self-maya" -H "$H" \
  -d '{"kind":"ok","idempotencyKey":"walk-1"}' | jq '.checkIn.reporterRole, .duplicate'
curl -s -X POST $B/people/$MAYA/checkins -H "x-daybridge-user: self-maya" -H "$H" \
  -d '{"kind":"ok","idempotencyKey":"walk-1"}' | jq '.duplicate'
# same key, different body → 409
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/people/$MAYA/checkins -H "x-daybridge-user: self-maya" -H "$H" \
  -d '{"kind":"help","idempotencyKey":"walk-1"}'

# 7. Viewer can't check in → 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/people/$MARG/checkins -H "x-daybridge-user: cg-lee" -H "$H" \
  -d '{"kind":"ok","idempotencyKey":"walk-2"}'

# 8. Ack an attention item; it stays in the list with acknowledgedByMe:true
ITEM=$(curl -s $B/people/$MAYA -H "x-daybridge-user: cg-dana" | jq -r '.attention[0].itemId')
curl -s -X POST "$B/attention/$ITEM/ack" -H "x-daybridge-user: cg-dana" | jq
curl -s $B/people/$MAYA -H "x-daybridge-user: cg-dana" | jq '.attention[] | {itemId, acknowledgedByMe}'

# 9. History with pagination
curl -s "$B/people/$MAYA/history?limit=2" -H "x-daybridge-user: cg-dana" | jq '.items, .nextCursor'

# 10. Revoke Lee on Margaret → Lee's next request is 404; revoking the last manager → 409
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $B/people/$MARG/grants/cg-lee  -H "x-daybridge-user: cg-dana"
curl -s -o /dev/null -w '%{http_code}\n' $B/people/$MARG -H "x-daybridge-user: cg-lee"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $B/people/$MARG/grants/cg-dana -H "x-daybridge-user: cg-dana"
```

Expected codes in order: 404, 401, then 201 → 200 → 409, 403, 204 → 404 → 409.
This walkthrough is **PROPOSED**. It hasn't been run against an implementation yet.
