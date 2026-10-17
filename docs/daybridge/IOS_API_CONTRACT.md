# DayBridge: iOS / Expo client contract

**Status: documentation only.** No iOS app exists. This describes how a future Expo / React Native client would use the coordination API under the cloud (Supabase) backend design. Source of truth for field names: the "Coordination contract v1" section of `src/lib/schema.ts`. Semantics: `COORDINATION_CONTRACT.md` and `src/domain/coordination/coordinator.ts`.

## 1. Base rules
- **HTTPS only.** Keep App Transport Security on with no `NSAllowsArbitraryLoads` and no ATS exceptions for the API host. Plain `http://` is only for local dev against `next dev`, and then only in a dev build that adds an `NSExceptionDomains` entry for that LAN host.
- Every request: `Content-Type: application/json` and `Authorization: Bearer <supabase access_token>`.
- Every response carries `x-daybridge-persistence: memory | supabase`. Show a "local only" badge when it is `memory`.
- Every plan carries `dataSource: "mock" | "live"`. Providers are **mock-only** today, so no real invite or ride is ever sent. Show a "Simulated providers" label whenever `dataSource === "mock"`.
- `plan.contractVersion` is currently `"1.0.0"`. Check the major version on every response (§9).

## 2. Authentication (Supabase Auth)
```ts
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";

// SecureStore caps a value at about 2 KB. If the session JSON grows past that, use a chunking adapter
// or AsyncStorage plus an encryption key stored in SecureStore.
const storage = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Refresh only while the app is in the foreground. iOS suspends timers in the background.
AppState.addEventListener("change", (s) =>
  s === "active" ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh());

// First launch: no sign-up form.
const { data: { session } } = await supabase.auth.getSession();
if (!session) await supabase.auth.signInAnonymously();
```
- **Getting the token:** call `(await supabase.auth.getSession()).data.session?.access_token` right before each request. Don't cache the token in app state, because it rotates on refresh.
- **On a 401:** call `supabase.auth.refreshSession()` once and retry once. If that also fails, sign in again. An anonymous user who loses their session also loses the plans tied to that user id (§8).
- **Upgrading later, with the same `user.id` so plans stay owned:**
  - Email: `supabase.auth.updateUser({ email })`, then verify through the emailed link or OTP.
  - Apple: `supabase.auth.linkIdentity({ provider: "apple" })` (manual linking must be enabled in the project). For native Sign in with Apple, use `signInWithIdToken` only when the user has **no** anonymous session; otherwise it creates a different user.
  - Don't call `signOut()` before upgrading. That throws the anonymous user away.
- **Keys:**
  - The Supabase URL and the publishable (anon) key are public by design, so shipping them in the app is fine.
  - Never ship a `service_role` / secret key or an AI key.
  - Never log access tokens, refresh tokens, or full request headers. Strip `Authorization` from crash-reporter breadcrumbs.

## 3. Endpoints
| Method and path | Body | 200 response |
|---|---|---|
| `POST /api/coordination/plans` | `CreatePlanInput` | `CommandResult` |
| `GET /api/coordination/plans/:id` | none | `{ plan: CoordinationPlan, events: CoordinationEvent[] }` (full log) |
| `POST /api/coordination/plans/:id/commands` | `PlanCommand` | `CommandResult` |
| `POST /api/coordination/plans/:id/events` | `ProviderEvent` | **Not a client endpoint; never call it.** Simulated provider callbacks for local demos only. In a production build with Supabase configured it **always returns 403** (there is no key or flag that opens it). Without Supabase it is open only on a local `next start` with `DAYBRIDGE_DEMO_EVENTS=1`. |

`CommandResult = { plan, outcome: "applied" | "duplicate" | "ignored" | "rejected", reason?, events }`. Here `events` holds only the events this call appended.

## 4. Two kinds of "no": HTTP errors vs domain rejections
- **HTTP 4xx/5xx** means the request never reached the state machine, or the server failed. The body is `{ "error": string }`.
- **HTTP 200 with `outcome: "rejected"`** means the request was valid but the plan refused it (wrong state, scope mismatch, expired approval, stale patch, and so on). The plan in the response is current, so re-render from it and show `reason` to the user. **Don't treat it as a transport error or retry it automatically.**

| Status | Meaning | Client action |
|---|---|---|
| 200 `applied` | State changed | Render `plan` |
| 200 `duplicate` | Already done (see §7) | Render `plan`; treat as success |
| 200 `rejected` | Valid request, refused by plan rules | Render `plan`, show `reason`, no auto-retry |
| 400 | Body failed schema validation (`"path: message"`) or the activity is unknown | Bug or bad input; show the message, don't retry |
| 401 | Bearer token missing or invalid | Refresh the session once, retry once, else re-auth |
| 403 | Forbidden (the events endpoint, always in production) | Don't retry; clients never call it |
| 404 | Unknown plan, **or a plan owned by another user** (existence is not leaked) | Remove the id from local storage |
| 409 | "Plan changed concurrently; retry" (the server already retried 3 times) | `GET` the plan, re-check that the user's intent still applies, then resend once |
| 500 | Server error | Retry with backoff only if the command is retry-safe (§7) |
| 503 | Production with no Supabase config, or the backend is unavailable | Show "service unavailable"; retry later |
| Network error / timeout | Unknown whether it applied | `GET` first, then retry only if it's retry-safe (§7) |

## 5. Flow with examples
**Create.** `activityId` must be a catalog id. Today these are hard-coded server-side (`choir`, `garden`, `bridge`, `walk`, ...; see gaps).
```json
POST /api/coordination/plans
{ "profile": { "name": "Maya", "interests": ["cards"], "mobility": "walker",
    "transport": ["bus", "family", "paratransit"], "maxTravelMin": 30, "times": ["afternoon"],
    "budgetPerWeek": 20, "hearingImpaired": false, "prefersSmallGroups": true },
  "activityId": "bridge",
  "contacts": [ { "id": "elaine", "name": "Elaine", "relation": "friend", "canDrive": false },
                { "id": "dan", "name": "Dan", "relation": "son", "canDrive": true } ] }
```
Rules: contacts are optional (at most 10, unique ids), and the id `"paratransit"` is reserved. `canDrive` defaults to `false`. Response (trimmed, illustrative values; field names exact):
```json
{ "outcome": "applied",
  "plan": { "id": "6f1c…", "contractVersion": "1.0.0", "version": 1, "state": "PROPOSED",
    "activityId": "bridge", "activityName": "Library Bridge & Cards", "when": "Wed afternoon",
    "blockers": [], "interventions": [{ "id": "…", "kind": "ride", "rule": "…", "description": "Ride from Dan (6 min)", "actionId": "6f1c…:v1:ride:dan" }],
    "actions": [{ "id": "6f1c…:v1:ride:dan", "interventionId": "…", "planVersion": 1, "description": "Ride from Dan (6 min)",
      "scope": { "kind": "ride", "activityId": "bridge", "recipientId": "dan", "sharedFields": ["name", "pickupWindow", "mobility"], "when": "Wed afternoon" },
      "status": "proposed", "idempotencyKey": "6f1c…:v1:ride:dan" }],
    "dependencies": [{ "id": "dep:6f1c…:v1:ride:dan", "actionId": "6f1c…:v1:ride:dan", "kind": "ride", "label": "Ride from Dan (6 min)", "status": "not_requested", "lastSequence": 0 }],
    "approvals": [], "alternatives": [{ "activityId": "garden", "name": "Neighborhood Garden Club", "when": "Sat morning" }],
    "preferencePatches": [], "dataSource": "mock", "profileVersion": 1, "createdAt": "…", "updatedAt": "…" },
  "events": [{ "seq": 1, "at": "…", "type": "plan.created", "actor": "user", "outcome": "applied", "payload": { "activityId": "bridge" } }] }
```
**Save `plan.id` locally right away.** There's no list endpoint (§10).

**Retrieve.** `GET /api/coordination/plans/:id` returns `{ plan, events }`.

**Accept.** `{ "type": "accept_proposal" }` (allowed only in `PROPOSED` or `NEEDS_REPLAN` with no blockers). The plan moves to `AWAITING_APPROVAL`. If there's nothing new to send, it moves to `PENDING_CONFIRMATION` or `READY` instead.

**Approve.** Send one `approve` per action whose `status` is `proposed` or `revoked`:
```json
{ "type": "approve", "actionId": "6f1c…:v1:ride:dan", "expiresAt": "2026-10-17T21:00:00Z",
  "scope": { "kind": "ride", "activityId": "bridge", "recipientId": "dan",
             "sharedFields": ["name", "pickupWindow", "mobility"], "when": "Wed afternoon" } }
```
- **Copy `action.scope` verbatim**, from the latest plan, into `scope`. The server compares `kind`, `activityId`, `recipientId` and `when` exactly, and `sharedFields` as a set (order doesn't matter, content does). Any difference returns `rejected` with "Approval scope does not match the proposed action". Never build a scope on the client.
- The approval card must show who (`recipientId` mapped to a contact name, or "Paratransit"), what (`description`), when, and **exactly which `sharedFields` are shared**.
- `expiresAt` is an ISO timestamp. It must be in the future and **≤ 24 h from server time**; otherwise the result is `rejected`. Use now + 1 h, which leaves room for device clock skew.
- Only valid in `AWAITING_APPROVAL`.
- **Revoke** before sending: `{ "type": "revoke", "actionId": "…" }`. This works only while the action is `approved`. Once dispatched, revoke is refused with "Already sent; cancel the plan instead".

**Execute.** `{ "type": "execute" }` dispatches every approved action atomically. If any approval is missing, revoked, expired or mismatched, nothing is sent: the result is `rejected` with `reason: "Not dispatched: …"`, and expired actions go back to `proposed` for re-approval. On success the plan moves to `PENDING_CONFIRMATION`, with dependencies `requested`. **Never show `requested` as booked.** If the result is `rejected` with "Some actions could not reach the provider; retry execute", the plan stays `AWAITING_APPROVAL` and those actions have `dispatchError: true`. Show a Retry button that sends `execute` again (it reuses the same idempotency keys).

**Status and events.** Poll `GET` every **5 s while the app is in the foreground and the plan is `PENDING_CONFIRMATION`**, every 30 s in other open states, and stop polling for `COMPLETED`/`CANCELLED`. Stop entirely in the background. Re-render from `plan` (state badge, dependency statuses) and show `events` as a timeline, with `duplicate`/`ignored`/`rejected` entries dimmed. Supabase Realtime is **not offered**: owner-scoped RLS select policies exist on `coordination_plans`/`coordination_events`, but subscribing isn't part of the contract. Treat GET as the only supported read.

**Replan.** `NEEDS_REPLAN` means a dependency was declined, cancelled or failed. A new proposal (bumped `plan.version`, new action ids) or blockers plus `alternatives` are attached. Old actions become `superseded`, so ignore them in the UI. Then either `accept_proposal` and approve the new actions, or send `{ "type": "choose_alternative", "activityId": "<one of plan.alternatives>" }` (allowed in `BLOCKED`, `PROPOSED` and `NEEDS_REPLAN`).

**Complete and feedback.** `{ "type": "complete", "attended": true }` works in `READY` only. In `COMPLETED`, send `{ "type": "feedback", "signals": ["too_crowded"] }` (allowed signals: `enjoyed`, `too_crowded`, `too_far`, `too_expensive`). This appends `preferencePatches` with `status: "proposed"`, for example `{ "id": "…:patch:1", "field": "prefersSmallGroups", "from": false, "to": true, "evidence": "…", "status": "proposed" }`. Show each patch as "I heard: …" with Confirm and Reject buttons, which send `{ "type": "confirm_preference", "patchId": "…" }` or `{ "type": "reject_preference", "patchId": "…" }`. Confirming a patch whose `from` no longer matches the profile returns `rejected` ("Stale patch").

**Cancel.** `{ "type": "cancel" }` works in any state except `COMPLETED`/`CANCELLED`. The `plan.cancelled` event lists `payload.dispatchedActionsToNotify`.

## 6. State machine (`PlanState`)
| State | Client shows | Allowed commands |
|---|---|---|
| `BLOCKED` | blockers and alternatives | `choose_alternative`, `cancel` |
| `PROPOSED` | interventions | `accept_proposal`, `choose_alternative`, `cancel` |
| `AWAITING_APPROVAL` | approval cards | `approve`, `revoke`, `execute`, `cancel` |
| `PENDING_CONFIRMATION` | "waiting for confirmations", poll | `execute` (returns duplicate), `cancel` |
| `READY` | "all confirmed" | `complete`, `cancel` |
| `NEEDS_REPLAN` | what failed, plus the recovery proposal or alternatives | `accept_proposal`, `choose_alternative`, `cancel` |
| `COMPLETED` | outcome and preference patches | `feedback`, `confirm_preference`, `reject_preference` |
| `CANCELLED` | final | none |

Anything else returns 200 `rejected`. The full diagram is in `COORDINATION_CONTRACT.md` §1. Drive buttons from `plan.state` plus action/patch statuses; never infer state on the client.

## 7. Idempotency and retries
There is **no client idempotency key** on commands. Retry safety comes from the state machine. Before retrying after a network error, timeout or 409, **`GET` the plan first** and check whether the intent already took effect.

| Command | Blind retry after it already succeeded | Safe? |
|---|---|---|
| `create` | Creates a **second plan** | **No.** After a lost response, there's no way to find the first plan (no list endpoint). Accept the orphan, or add a gap fix (§10). |
| `accept_proposal` | `rejected` ("Cannot accept a proposal in AWAITING_APPROVAL") | Yes, no side effect; treat that rejection as success if the GET shows the new state |
| `approve` | `duplicate` while the action is still `approved` and the plan is in `AWAITING_APPROVAL`. If execute already ran, the result is `rejected` (wrong state); a retry with a now-expired `expiresAt` is also `rejected`. | Yes |
| `revoke` | `rejected` ("Action is revoked") | Yes |
| `execute` | `duplicate` ("Already dispatched") once the plan is in `PENDING_CONFIRMATION`/`READY`. After a provider error it re-dispatches with the same `idempotencyKey`, and the provider dedupes. | Yes. This is the one command designed for retry. |
| `choose_alternative` | Usually `rejected` ("Not one of the offered alternatives"), because the alternatives list is recomputed | Yes, but GET first: on success it replans and bumps `version` |
| `complete` | `rejected` ("Plan is COMPLETED") | Yes |
| `cancel` | `rejected` ("Plan is CANCELLED"), so the call **is not idempotent in outcome** but is idempotent in effect | Yes; treat `rejected` + `plan.state === "CANCELLED"` as success |
| `feedback` | **Appends another set of patches** | **No.** GET first and skip if patches for this feedback already exist |
| `confirm_preference` / `reject_preference` | `duplicate` once the patch is no longer `proposed` (including confirm after reject) | Yes |

Rejected and duplicate attempts are still appended to the event log, so retries show up in the timeline.

## 8. Token and data handling
- Store only the Supabase session (in SecureStore) and a local list of `{ planId, activityName, createdAt }`.
- Plans contain contacts' names: personal data. Don't write plan JSON to logs, analytics, or unencrypted caches.
- Anonymous users: deleting the app or losing the keychain session loses access to their plans (they become 404). Prompt the user to upgrade (§2) before a plan holds anything they'd care to lose.

## 9. Versioning
- Today: `plan.contractVersion` (semver, currently `1.0.0`). Changes within the same major version are additive only. Clients must ignore unknown fields and treat unknown `state`, `type` or `status` values as "unknown, refresh / update the app" rather than crashing. If the major version is higher than the app supports, show "please update".
- **Future (not built):** a `/api/v1/coordination/...` path alias or an `Accept-Version: 1` request header, so a breaking v2 can coexist with shipped iOS builds. Also a minimum-client-version check. None of this exists yet.

## 10. Gaps before an iOS build
1. **No list-my-plans endpoint.** The client must keep plan ids locally, and a lost response on `create` orphans that plan. Add `GET /api/coordination/plans` (owner-scoped).
2. **No idempotency key on `create`/`feedback`.** Add an optional `clientRequestId` (or an `Idempotency-Key` header) that the server dedupes per user.
3. **No activity catalog endpoint.** `activityId` values are hard-coded server-side. Add `GET /api/activities`, or have the client run `/api/analyze` first.
4. **No API versioning beyond `contractVersion`** (§9).
5. **No push notifications.** Polling only; an APNs hook on `plan.ready` / `plan.replan_required` would replace foreground polling.
6. **Rate limits** are proposed, not specified. Expect a future 429 and handle it like 503.
7. **Providers are mock-only** (`dataSource: "mock"`). Live invites and rides need HMAC-verified callbacks and server-side dedupe first.
8. **Anonymous-to-Apple upgrade** must be verified against the project's identity-linking settings before release.
9. **No account or data deletion endpoint.** App Store guideline 5.1.1(v) requires in-app account deletion once accounts are permanent.
