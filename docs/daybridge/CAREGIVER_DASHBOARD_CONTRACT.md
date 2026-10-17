# Caregiver Dashboard: API Contract (v1)

> **Status of this document:** reconciled against the implementation on branch `feat/caregiver-backend` (PR #33, head `e414444`). **That PR is open and not merged to `main`.**
> - **IMPLEMENTED (branch)** means the code was read and matches this doc, and the behaviour shows in the branch's recorded walkthrough or tests. It is not on `main` until #33 merges.
> - **PROPOSED** means spec only.
>
> Source of truth: `src/domain/caregiver/contract.ts` (Zod and read-model types), `src/app/api/caregiver/_lib/service.ts` (routes and errors), and `src/domain/caregiver/*` (pure derivations). UI handoff: `docs/handoffs/caregiver-dashboard-ui.md`.

The caregiver dashboard lets a caregiver see the people they support, what each person has coming up, what needs attention, and recent check-ins. It reuses the existing coordinator (the `coordinator` singleton in `src/app/api/coordination/_lib/service.ts`). It adds no new plan state machine. It never approves, executes, completes or records attendance on a plan.

## 1. Ground rules

| Rule | Status | Where |
|---|---|---|
| Every route is under `/api/caregiver`, speaks JSON, and requires a caller (except `POST /demo`, see §4) | IMPLEMENTED (branch) | `service.ts` `withCaller` |
| Only explicit **grants** give access. Relationships, contacts and share links never do | IMPLEMENTED (branch) | `access.ts` `decideAccess` |
| No grant at all → **404 "Person not found"**, never 403 (no existence leak) | IMPLEMENTED (branch) | `access.ts`; walkthrough (cg-lee → Maya) |
| Plans are created only through `POST /people/:id/plans` (`coordinator.create` with the person's profile). There is no link-existing-plan endpoint, and a plan links to exactly one person (409 otherwise) | IMPLEMENTED (branch) | `service.ts` `createPlan`; `store.linkPlan` |
| Check-ins and acks never call the coordinator's command path | IMPLEMENTED (branch) | `checkins.ts`, `service.ts` `ack` |
| Dependency status and `outcome` (`self_reported`) are reported separately | IMPLEMENTED (branch) | `history.ts` `planSummary` |
| Every response, **including error bodies**, carries `labels` | IMPLEMENTED (branch) | `service.ts` `reply` |
| No `checkInSchedule` → never an overdue item | IMPLEMENTED (branch) | `attention.ts` |
| Coordinator text that could contain contact names (action descriptions, dependency labels) is replaced with fixed labels. Action ids are opaque hashes | IMPLEMENTED (branch) | `history.ts` `safeActionLabel`, `opaqueActionId` |

## 2. Identity and availability

| Environment | Behaviour | Status |
|---|---|---|
| Hosted production (`NODE_ENV=production`) without `DAYBRIDGE_DEMO_EVENTS=1` | **503** `{"error":"Caregiver dashboard needs sign-in and storage; available in the local demo","labels":{…}}` on every route, **checked before identity** | IMPLEMENTED (branch) |
| Local/dev, or the flag on | Caller from header `x-daybridge-user`, matching `^[a-z0-9-]{3,40}$` | IMPLEMENTED (branch) |
| Header missing or invalid | **401** `{"error":"Missing or invalid caller (x-daybridge-user)","labels":{…}}` | IMPLEMENTED (branch) |

Ports (`service.ts` `ports`):
- `CallerResolver` (`_lib/caller.ts`). Default `headerCallerResolver`. The Supabase session resolver comes from the cloud lane (PR #23): PROPOSED.
- `CaregiverStore` (`src/domain/caregiver/store.ts`). Default `memoryCaregiverStore` (`kind: "memory"`, on `globalThis`, lost on restart). A durable store would report `"durable"`: PROPOSED.

## 3. TypeScript types (as implemented)

From `src/domain/caregiver/contract.ts`. `PlanState`, `Profile` and `Contact` come from `src/lib/schema.ts`.

```ts
type Labels = { storage: "memory" | "durable"; providers: "simulated"; generatedAt: string };
type ErrorBody = { error: string; labels: Labels };

type UserId = string;                         // /^[a-z0-9-]{3,40}$/
type Scope = "view" | "checkin" | "manage";   // arrays: min 1, deduped

type Person = {
  personId: string;                           // uuid
  profile: Profile;
  timezone: string;                           // IANA, checked with Intl.DateTimeFormat
  selfUserId?: UserId;
  checkInSchedule: { everyDays: number /* int 1..14 */ } | null;
  createdAt: string;
  createdBy: UserId;
};

type Grant = { personId: string; userId: UserId; scopes: Scope[]; grantedBy: UserId; grantedAt: string; revokedAt?: string };
type PlanLink = { personId: string; planId: string; linkedAt: string; linkedBy: UserId };

// Full record: only returned to the reporter by POST /checkins
type CheckIn = {
  checkInId: string; personId: string; kind: "ok" | "call" | "help"; planId?: string;
  note?: string;                              // trimmed, 1..280
  reporterUserId: UserId; reporterRole: "self" | "caregiver"; source: "app" | "demo";
  at: string; idempotencyKey: string;         // 1..80
};

// What reads return (person detail, history): no reporterUserId, no idempotencyKey
type CheckInView = {
  checkInId: string; kind: "ok" | "call" | "help"; planId?: string;
  reporterRole: "self" | "caregiver"; source: "app" | "demo"; at: string;
  note?: string;                              // only for the reporter or a manager
  hasNote?: true;                             // set instead of note for everyone else
};

type AttentionKind = "approval_needed" | "confirmation_pending" | "plan_disrupted"
                   | "help_requested" | "call_requested" | "checkin_overdue";
type AttentionItem = {
  itemId: string; kind: AttentionKind; personId: string; planId?: string;
  title: string; detail: string; createdAt: string; acknowledgedByMe: boolean;
};

type Upcoming = { planId: string; activityName: string; slot: string; nextDate: string /* YYYY-MM-DD */; timezone: string; state: PlanState };

type PlanSummary = {
  planId: string; activityName: string; when: string; state: PlanState; version: number;
  outstandingApprovals: { actionId: string /* "act_<16 hex>" opaque */; kind: "invite" | "ride"; description: string }[];
  dependencies: { kind: "invite" | "ride"; label: string; status: string /* DependencyStatus: not_requested|requested|confirmed|declined|cancelled|failed */ }[];
  outcome?: { attended: boolean; source: "self_reported" };
  updatedAt: string;
};

type PersonSummary = {
  personId: string; displayName: string; timezone: string; nextActivity: Upcoming | null;
  attentionCount: number;
  latestCheckIn: { kind: "ok" | "call" | "help"; at: string; reporterRole: "self" | "caregiver" } | null;
  myScopes: Scope[];
};

type HistoryItem = {
  at: string; type: "plan_state" | "dependency" | "attendance" | "feedback" | "checkin";
  planId?: string; summary: string;
  checkIn?: CheckInView;                      // present on type "checkin"
};

// ---- request bodies (Zod) ----
type CreatePersonInput = { profile: Profile; timezone: string; selfUserId?: UserId; checkInSchedule?: { everyDays: number } | null };
type GrantInput = { userId: UserId; scopes: Scope[] };
type CreatePersonPlanInput = { activityId: string; contacts?: Contact[] /* max 10, unique ids, "paratransit" reserved; default [] */ };
type CheckInInput = { kind: "ok" | "call" | "help"; planId?: string; note?: string /* trimmed 1..280 */; idempotencyKey: string /* 1..80 */ };

// ---- responses (every one also has `labels: Labels`) ----
type OverviewResponse     = { people: PersonSummary[] };               // sorted by displayName
type CreatePersonResponse = Person;                                     // 201
type PersonDetailResponse = { person: Person; plans: PlanSummary[]; upcoming: Upcoming[]; attention: AttentionItem[];
                              latestCheckIns: CheckInView[] /* ≤5, newest first */; myScopes: Scope[] };
type ListGrantsResponse   = { grants: Grant[] };                        // active only
type UpsertGrantResponse  = Grant;                                      // 201
type CreatePlanResponse   = { planId: string; state: PlanState };       // 201
type CheckInResponse      = { checkIn: CheckIn; duplicate: boolean };   // 201 new, 200 duplicate
type AckResponse          = { itemId: string; acknowledgedByMe: true };
type HistoryResponse      = { items: HistoryItem[]; nextCursor: string | null };
type DemoSeedResponse     = {
  users: { dana: "cg-dana"; lee: "cg-lee"; selfMaya: "self-maya" };
  people: {
    maya:     { personId: "7d1f0a52-4c1e-4b8a-9a0e-6d6179610001"; planId: string; state: PlanState };
    margaret: { personId: "7d1f0a52-4c1e-4b8a-9a0e-6d6172670002"; planId: string; state: PlanState };
  };
};
```

## 4. Endpoints

| Method | Path | Required scope | Success | Errors | Status |
|---|---|---|---|---|---|
| GET | `/overview` | `view` on each listed person (others omitted) | 200 | 401, 503 | IMPLEMENTED (branch) |
| POST | `/people` | any caller; caller gets `view`+`checkin`+`manage` | 201 `Person` | 400, 401, 503 | IMPLEMENTED (branch) |
| GET | `/people/:id` | `view` | 200 | 401, 403, 404, 503 | IMPLEMENTED (branch) |
| GET | `/people/:id/grants` | `manage` | 200 `{grants}` | 401, 403, 404 | IMPLEMENTED (branch) |
| POST | `/people/:id/grants` | `manage` | 201 `Grant` (upsert replaces scopes; also un-revokes) | 400, 403, 404, **409** (would remove the last manager) | IMPLEMENTED (branch) |
| DELETE | `/people/:id/grants/:userId` | `manage` | 204 | 403, 404 (person, or no active grant), **409** "Cannot revoke the last manager" | IMPLEMENTED (branch) |
| POST | `/people/:id/plans` | `manage` | 201 `{planId, state}` | 400, 403, 404, 409 (already linked); coordinator errors pass through with their status | IMPLEMENTED (branch) |
| POST | `/people/:id/checkins` | `checkin`, or caller is `selfUserId` | 201 new, 200 `duplicate:true` | 400 (incl. `planId` not linked to this person), 403, 404, **409** (key reused, different body) | IMPLEMENTED (branch) |
| POST | `/attention/:itemId/ack` | `view` on the item's person | 200 | 404 "Attention item not found" (unknown, no longer current, or no grant) | IMPLEMENTED (branch) |
| GET | `/people/:id/history?limit=&cursor=` | `view` | 200 | 400 (bad limit/cursor), 403, 404 | IMPLEMENTED (branch) |
| POST | `/demo` | **no caller needed**; dev or flag only | 201 `DemoSeedResponse` | 503 | IMPLEMENTED (branch) |

`itemId` contains `:`. URL-encode it in the path (`approval_needed%3A<planId>%3Av1`).

## 5. Permissions matrix

`self` = caller equals `person.selfUserId`. Scopes are independent: `manage` does not imply `checkin` or `view`.

| Action | view | checkin | manage | self, no grant | no grant | Status |
|---|---|---|---|---|---|---|
| Listed in overview | yes | only if also `view` | only if also `view` | no | no | IMPLEMENTED (branch) |
| GET person detail / history | yes | 403 without `view` | 403 without `view` | **404** | **404** | IMPLEMENTED (branch) |
| Read check-in note text | own notes only | own notes only | **all notes** | n/a (no read access) | n/a | IMPLEMENTED (branch) |
| POST check-in | 403 | yes → `reporterRole:"caregiver"` | 403 without `checkin` | yes → `reporterRole:"self"` | **404** | IMPLEMENTED (branch) |
| Ack attention item | yes | 403 without `view` | 403 without `view` | 404 | 404 | IMPLEMENTED (branch) |
| Create plan, list/grant/revoke | 403 | 403 | yes | 404 | 404 | IMPLEMENTED (branch) |

A revoked grant takes effect on the next request (404). Covered by `src/app/api/caregiver/route.test.ts` on the branch.

## 6. Derived data (recomputed on every read)

### Attention items (`src/domain/caregiver/attention.ts`)

| `itemId` | When | Status |
|---|---|---|
| `approval_needed:<planId>:v<version>` | Plan state is AWAITING_APPROVAL. *Differs from spec:* there is no separate NEEDS_REPLAN case, because accepting a replan proposal moves the plan to AWAITING_APPROVAL | IMPLEMENTED (branch) |
| `confirmation_pending:<planId>:v<version>` | PENDING_CONFIRMATION. `detail` reads "Requested, not yet confirmed: <safe labels>" | IMPLEMENTED (branch) |
| `plan_disrupted:<planId>:v<version>` | NEEDS_REPLAN | IMPLEMENTED (branch) |
| `help_requested:<checkInId>` | Every `help` check-in | IMPLEMENTED (branch) |
| `call_requested:<checkInId>` | Latest `call` only, while no later `ok` from the same `reporterRole` exists | IMPLEMENTED (branch) |
| `checkin_overdue:<personId>:<windowStartISO>` | Schedule set, and now > (last check-in, or `createdAt`) + `everyDays` days | IMPLEMENTED (branch) |

An ack only sets `acknowledgedByMe: true` for that user, and the item stays. A new plan version produces a new id.

### Upcoming (`upcoming.ts`)
Open plans only (not COMPLETED or CANCELLED). `nextDate` is the next occurrence, counting today, of the weekday in `plan.when` ("Sun afternoon" → Sun) in the person's timezone. It is computed with pure calendar arithmetic, so DST can't shift it. Sorted by `nextDate`. Overview `nextActivity` = first upcoming. Status: IMPLEMENTED (branch).

### History (`history.ts`)
Applied coordinator events only (rejected, duplicate and ignored events are dropped), plus check-ins. Newest first.

| Source | `type` | `summary` (exact) |
|---|---|---|
| `plan.ready` / `plan.ready_revoked` / `plan.replan_required` | `plan_state` | "Plan is ready" / "Plan is no longer ready" / "Plan needs a new arrangement" |
| `plan.completed` | `attendance` | "Attended (self-reported)" / "Did not attend (self-reported)" |
| `preference.updated` | `feedback` | "Preferences updated from feedback" |
| `ride.*` / `invite.*` (requested, confirmed, accepted→confirmed, cancelled, declined, failed) | `dependency` | "Ride: confirmed", "Invite: requested", … |
| check-in | `checkin` | "Check-in: ok (caregiver)", with a `checkIn: CheckInView` |

Never included: payloads, scopes, `sharedFields`, `requestId`s, approval ids, idempotency keys, contact ids or names, tokens. Status: IMPLEMENTED (branch).

## 7. Pagination

| Rule | Status |
|---|---|
| `limit` defaults to 20. Non-integer or < 1 → 400 "limit must be a positive integer". Values > 50 are **clamped** to 50 | IMPLEMENTED (branch) |
| `cursor` is opaque (base64url of JSON `[at, key]`). Pass `nextCursor` back unchanged. An undecodable cursor → 400 "Invalid cursor" | IMPLEMENTED (branch) |
| `nextCursor: null` = end of list. Keyset pagination: items added later never duplicate a page | IMPLEMENTED (branch) |

## 8. Errors

Body: `{ "error": string, "labels": Labels }`. Messages are safe to show.

| Status | Implemented messages |
|---|---|
| 400 | `"<field path>: <zod message>"` (e.g. note too long, unknown time zone), "planId is not one of this person's plans", "limit must be a positive integer", "Invalid cursor" |
| 401 | "Missing or invalid caller (x-daybridge-user)" |
| 403 | `Requires the "view" / "checkin" / "manage" scope` |
| 404 | "Person not found" (unknown person **or no grant**), "Attention item not found", "Grant not found" |
| 409 | "Cannot revoke the last manager", "Cannot remove the last manager", "Idempotency key was already used with a different check-in", "Plan is already linked to a person" |
| 503 | "Caregiver dashboard needs sign-in and storage; available in the local demo" |

All of the above: IMPLEMENTED (branch).

## 9. Fixtures (`POST /api/caregiver/demo`, fictional; `src/domain/caregiver/fixtures.ts`)

Person ids are **fixed**, so re-seeding replaces the earlier demo people. Plan ids are new on each seed.

| Fixture | Data | Status |
|---|---|---|
| `cg-dana` | view+checkin+manage on Maya and Margaret | IMPLEMENTED (branch) |
| `cg-lee` | `view` on Margaret only | IMPLEMENTED (branch) |
| `self-maya` | Maya's `selfUserId` (no grant: check-in only) | IMPLEMENTED (branch) |
| Maya `7d1f0a52-4c1e-4b8a-9a0e-6d6179610001` | "Sunday Fellowship Lunch" (`fellowship`), Sun afternoon, accepted → AWAITING_APPROVAL (ride + invite awaiting approval). America/Los_Angeles, `everyDays: 3`, created 7 days ago. One caregiver `ok` check-in 4 days ago (`source: "demo"`) → overdue | IMPLEMENTED (branch) |
| Margaret `7d1f0a52-4c1e-4b8a-9a0e-6d6172670002` | "Central Library Community Room Cards" (`bridge`), Wed afternoon, READY (no dependencies). America/New_York, no schedule, no `selfUserId` | IMPLEMENTED (branch) |

## 10. Recorded walkthrough (from `docs/daybridge/caregiver-api-walkthrough.txt` on `feat/caregiver-backend`)

The text below is pasted verbatim. The server ran on port 4300; use your own port (`npm run dev` defaults to 3000).

```text
# DayBridge caregiver API walkthrough (fictional demo data, local dev server, simulated providers)

$ curl -s -X POST http://localhost:4300/api/caregiver/demo
{"users":{"dana":"cg-dana","lee":"cg-lee","selfMaya":"self-maya"},"people":{"maya":{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6179610001","planId":"5ed19303-b06c-4fa8-a187-ba2701280bc8","state":"AWAITING_APPROVAL"},"margaret":{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6172670002","planId":"c2155184-2e63-4fa8-8899-f745a2083509","state":"READY"}},"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:17.933Z"}}

$ curl -s http://localhost:4300/api/caregiver/overview -H 'x-daybridge-user: cg-dana'
{"people":[{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6172670002","displayName":"Margaret","timezone":"America/New_York","nextActivity":{"planId":"c2155184-2e63-4fa8-8899-f745a2083509","activityName":"Central Library Community Room Cards","slot":"Wed afternoon","nextDate":"2026-10-21","timezone":"America/New_York","state":"READY"},"attentionCount":0,"latestCheckIn":null,"myScopes":["view","checkin","manage"]},{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6179610001","displayName":"Maya","timezone":"America/Los_Angeles","nextActivity":{"planId":"5ed19303-b06c-4fa8-a187-ba2701280bc8","activityName":"Sunday Fellowship Lunch","slot":"Sun afternoon","nextDate":"2026-10-18","timezone":"America/Los_Angeles","state":"AWAITING_APPROVAL"},"attentionCount":2,"latestCheckIn":{"kind":"ok","at":"2026-10-13T21:40:17.873Z","reporterRole":"caregiver"},"myScopes":["view","checkin","manage"]}],"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:18.615Z"}}

$ curl -s http://localhost:4300/api/caregiver/overview -H 'x-daybridge-user: cg-lee'
{"people":[{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6172670002","displayName":"Margaret","timezone":"America/New_York","nextActivity":{"planId":"c2155184-2e63-4fa8-8899-f745a2083509","activityName":"Central Library Community Room Cards","slot":"Wed afternoon","nextDate":"2026-10-21","timezone":"America/New_York","state":"READY"},"attentionCount":0,"latestCheckIn":null,"myScopes":["view"]}],"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:19.400Z"}}

$ curl -s -w ' HTTP %{http_code}' http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001 -H 'x-daybridge-user: cg-lee'
{"error":"Person not found","labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:23.763Z"}} HTTP 404

$ curl -s -w ' HTTP %{http_code}' http://localhost:4300/api/caregiver/overview
{"error":"Missing or invalid caller (x-daybridge-user)","labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:23.996Z"}} HTTP 401

$ curl -s -w ' HTTP %{http_code}' -X POST http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001/checkins -H 'x-daybridge-user: cg-dana' -H 'content-type: application/json' -d '{"kind":"ok","note":"Had lunch, all good","idempotencyKey":"walkthrough-1"}'
{"checkIn":{"checkInId":"063a31fb-4c19-46ff-b6a1-86060d2cf525","personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6179610001","kind":"ok","note":"Had lunch, all good","reporterUserId":"cg-dana","reporterRole":"caregiver","source":"app","at":"2026-10-17T21:40:33.446Z","idempotencyKey":"walkthrough-1"},"duplicate":false,"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:33.446Z"}} HTTP 201

$ curl -s -w ' HTTP %{http_code}' -X POST http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001/checkins -H 'x-daybridge-user: cg-dana' -H 'content-type: application/json' -d '{"kind":"ok","note":"Had lunch, all good","idempotencyKey":"walkthrough-1"}'
{"checkIn":{"checkInId":"063a31fb-4c19-46ff-b6a1-86060d2cf525","personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6179610001","kind":"ok","note":"Had lunch, all good","reporterUserId":"cg-dana","reporterRole":"caregiver","source":"app","at":"2026-10-17T21:40:33.446Z","idempotencyKey":"walkthrough-1"},"duplicate":true,"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:34.956Z"}} HTTP 200

$ curl -s -w ' HTTP %{http_code}' -X POST http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001/checkins -H 'x-daybridge-user: cg-dana' -H 'content-type: application/json' -d '{"kind":"help","idempotencyKey":"walkthrough-1"}'
{"error":"Idempotency key was already used with a different check-in","labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:35.375Z"}} HTTP 409

$ curl -s -w ' HTTP %{http_code}' -X POST http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6172670002/checkins -H 'x-daybridge-user: cg-lee' -H 'content-type: application/json' -d '{"kind":"ok","idempotencyKey":"lee-1"}'
{"error":"Requires the \"checkin\" scope","labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:35.764Z"}} HTTP 403

$ curl -s http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001 -H 'x-daybridge-user: cg-dana'
{"person":{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6179610001","profile":{"name":"Maya","interests":["faith"],"mobility":"walker","transport":["family","paratransit"],"maxTravelMin":30,"times":["afternoon"],"budgetPerWeek":10,"hearingImpaired":false,"prefersSmallGroups":true},"timezone":"America/Los_Angeles","selfUserId":"self-maya","checkInSchedule":{"everyDays":3},"createdAt":"2026-10-10T21:40:17.873Z","createdBy":"cg-dana"},"plans":[{"planId":"5ed19303-b06c-4fa8-a187-ba2701280bc8","activityName":"Sunday Fellowship Lunch","when":"Sun afternoon","state":"AWAITING_APPROVAL","version":1,"outstandingApprovals":[{"actionId":"act_69ae1c42fdef42cb","kind":"ride","description":"Ride from a contact"},{"actionId":"act_d1093285529ff7fd","kind":"invite","description":"Invite a contact to come along"}],"dependencies":[{"kind":"ride","label":"Ride from a contact","status":"not_requested"},{"kind":"invite","label":"Invite a contact to come along","status":"not_requested"}],"updatedAt":"2026-10-17T21:40:17.931Z"}],"upcoming":[{"planId":"5ed19303-b06c-4fa8-a187-ba2701280bc8","activityName":"Sunday Fellowship Lunch","slot":"Sun afternoon","nextDate":"2026-10-18","timezone":"America/Los_Angeles","state":"AWAITING_APPROVAL"}],"attention":[{"personId":"7d1f0a52-4c1e-4b8a-9a0e-6d6179610001","planId":"5ed19303-b06c-4fa8-a187-ba2701280bc8","createdAt":"2026-10-17T21:40:17.931Z","itemId":"approval_needed:5ed19303-b06c-4fa8-a187-ba2701280bc8:v1","kind":"approval_needed","title":"Approval needed: Sunday Fellowship Lunch","detail":"Arrangements are waiting for approval before anything is sent.","acknowledgedByMe":false}],"latestCheckIns":[{"checkInId":"063a31fb-4c19-46ff-b6a1-86060d2cf525","kind":"ok","reporterRole":"caregiver","source":"app","at":"2026-10-17T21:40:33.446Z","note":"Had lunch, all good"},{"checkInId":"89c7098c-c46b-4bf1-a491-6674a800dca4","kind":"ok","reporterRole":"caregiver","source":"demo","at":"2026-10-13T21:40:17.873Z"}],"myScopes":["view","checkin","manage"],"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:36.143Z"}}

$ curl -s 'http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001/history?limit=20' -H 'x-daybridge-user: cg-dana'
{"items":[{"at":"2026-10-17T21:40:33.446Z","type":"checkin","summary":"Check-in: ok (caregiver)","checkIn":{"checkInId":"063a31fb-4c19-46ff-b6a1-86060d2cf525","kind":"ok","reporterRole":"caregiver","source":"app","at":"2026-10-17T21:40:33.446Z","note":"Had lunch, all good"}},{"at":"2026-10-13T21:40:17.873Z","type":"checkin","summary":"Check-in: ok (caregiver)","checkIn":{"checkInId":"89c7098c-c46b-4bf1-a491-6674a800dca4","kind":"ok","reporterRole":"caregiver","source":"demo","at":"2026-10-13T21:40:17.873Z"}}],"nextCursor":null,"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:46.158Z"}}

$ curl -s -w ' HTTP %{http_code}' -X POST http://localhost:4300/api/caregiver/attention/approval_needed%3A5ed19303-b06c-4fa8-a187-ba2701280bc8%3Av1/ack -H 'x-daybridge-user: cg-dana'
{"itemId":"approval_needed:5ed19303-b06c-4fa8-a187-ba2701280bc8:v1","acknowledgedByMe":true,"labels":{"storage":"memory","providers":"simulated","generatedAt":"2026-10-17T21:40:50.973Z"}} HTTP 200

$ curl -s http://localhost:4300/api/caregiver/people/7d1f0a52-4c1e-4b8a-9a0e-6d6179610001 -H 'x-daybridge-user: cg-dana' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).attention,null,1)))"
[
 {
  "personId": "7d1f0a52-4c1e-4b8a-9a0e-6d6179610001",
  "planId": "5ed19303-b06c-4fa8-a187-ba2701280bc8",
  "createdAt": "2026-10-17T21:40:17.931Z",
  "itemId": "approval_needed:5ed19303-b06c-4fa8-a187-ba2701280bc8:v1",
  "kind": "approval_needed",
  "title": "Approval needed: Sunday Fellowship Lunch",
  "detail": "Arrangements are waiting for approval before anything is sent.",
  "acknowledgedByMe": true
 }
]
```

The recorded run shows these points:
- Maya's `attentionCount` is 2 after seeding (approval + overdue).
- After Dana's `ok` check-in, only the approval item remains.
- The acked item stays listed with `acknowledgedByMe: true`.
- History has no plan events yet, because accepting a plan emits none that the history projection maps.

### Extra steps (not in the recorded run; PROPOSED until rerun)

```bash
B=http://localhost:3000/api/caregiver; MAYA=7d1f0a52-4c1e-4b8a-9a0e-6d6179610001; MARG=7d1f0a52-4c1e-4b8a-9a0e-6d6172670002
# self check-in (no grant) → 201, reporterRole "self"; self reading detail → 404
curl -s -X POST $B/people/$MAYA/checkins -H 'x-daybridge-user: self-maya' -H 'content-type: application/json' -d '{"kind":"call","idempotencyKey":"self-1"}'
curl -s -o /dev/null -w '%{http_code}\n' $B/people/$MAYA -H 'x-daybridge-user: self-maya'
# revoke Lee → 204, then Lee → 404; revoking the last manager → 409
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $B/people/$MARG/grants/cg-lee -H 'x-daybridge-user: cg-dana'
curl -s -o /dev/null -w '%{http_code}\n' $B/people/$MARG -H 'x-daybridge-user: cg-lee'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $B/people/$MARG/grants/cg-dana -H 'x-daybridge-user: cg-dana'
```

## 11. Spec deviations found while reconciling

1. `approval_needed` fires only in AWAITING_APPROVAL. The spec's "NEEDS_REPLAN with proposed/revoked actions after accept" case can't occur, because accepting a replan proposal moves the plan to AWAITING_APPROVAL.
2. `POST /demo` needs no caller header. It is still fail-closed (503) when hosted.
3. The demo seed response is grouped per person (`people.maya.{personId, planId, state}`), and the user keys are `dana/lee/selfMaya`.
4. Read endpoints return `CheckInView`, which omits `reporterUserId` and `idempotencyKey`. Only the reporter's own `POST` response returns the full `CheckIn`.
5. Error bodies include `labels`.
6. `limit` > 50 is clamped, not rejected.
7. Dependency and approval labels are fixed generic strings ("Ride from a contact", "Paratransit ride", "Invite a contact to come along"), so contact names never appear.
8. `POST /attention/:itemId/ack` returns 404 "Attention item not found" for an unknown item, an item that is no longer current, or a person with no grant. A grant without `view` gets 403.
