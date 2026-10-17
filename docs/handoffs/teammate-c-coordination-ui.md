# Handoff: Teammate C, Coordination UI

Read [README.md](README.md) first (setup and team rules). Then read the API you'll consume: [`docs/daybridge/COORDINATION_CONTRACT.md`](../daybridge/COORDINATION_CONTRACT.md).

**Branch:** start from `feat/coordination-engine` (PR #3) until it's merged, then from `main`:
```bash
git fetch origin && git checkout -b ui/coordination origin/feat/coordination-engine
npm install && npm run dev        # http://localhost:3000/coordinate once you create the page
```

## What you're building
The engine already exists and is tested; **you build the screen that makes it visible to judges.**
DayBridge doesn't just suggest an activity. It **gets the person there**:
1. It proposes the smallest fix: "Dan drives you" plus "Invite Elaine, since it's a big group".
2. It asks permission for each action, showing exactly what will be shared.
3. It waits for real confirmations.
4. It marks the plan **READY** only when every confirmation is in.
5. When the ride is cancelled, it visibly drops out of READY and offers a recovery.

Your screen has to make that story obvious in about 60 seconds.

## You own (new files only)
- `src/app/coordinate/page.tsx`: the new page at `/coordinate`
- `src/components/coordination/**`: your components

**Don't edit:**
- Teammate A's files: `src/app/page.tsx`, `src/components/dashboard/**`, `src/components/ui/**`, `layout.tsx`, `globals.css`. You *may import* `src/components/ui/*` (button, card, badge, textarea). Ask A if you need a new shadcn component added.
- The engine and API: `src/domain/**`, `src/app/api/**`, `src/lib/**`. If you need an API change, ask Claude/the lead.

**Integration point with A:** A adds one "Get me there →" link on each plan card that goes to `/coordinate?activityId=<id>`. The page must also work standalone through the demo button below.

## The API (all `POST` bodies are JSON; every response is `CommandResult`)
```
POST /api/coordination/plans                 { profile, activityId, contacts }   → CommandResult
GET  /api/coordination/plans/:id                                                  → { plan, events }
POST /api/coordination/plans/:id/commands    { type: "...", ... }                 → CommandResult
POST /api/coordination/plans/:id/events      ProviderEvent (demo-only simulator)  → CommandResult
```
`CommandResult = { plan, outcome: "applied" | "duplicate" | "ignored" | "rejected", reason?, events }`. Types: `import type { CommandResult, CoordinationPlan, CoordinationEvent } from "@/lib/schema"`.

- **A refused command still returns HTTP 200** with `outcome: "rejected"` and a human-readable `reason`. Show the `reason` to the user, for example "Not dispatched: … not approved".
- HTTP 400 means you sent a malformed body (a bug on your side). 404 means an unknown plan id.

**Commands:**
- `accept_proposal`
- `approve` `{ actionId, scope, expiresAt }`: send the action's `scope` back **unchanged**; `expiresAt` = now + 1h, ISO string
- `revoke` `{ actionId }`
- `execute`
- `choose_alternative` `{ activityId }`
- `complete` `{ attended }`
- `cancel`
- `feedback` `{ signals: ["too_crowded" | "too_far" | "too_expensive" | "enjoyed"] }`
- `confirm_preference` `{ patchId }`
- `reject_preference` `{ patchId }`

## Demo fixture (verified against the current activity catalog)
A **"Load demo: Maya"** button should create the plan below. Today it produces exactly two actions: **ride from Dan** and **invite Elaine**. Paratransit is the backup when Dan cancels.
```json
{
  "activityId": "fellowship",
  "profile": { "name": "Maya", "interests": ["faith"], "mobility": "walker", "transport": ["family", "paratransit"],
               "maxTravelMin": 30, "times": ["afternoon"], "budgetPerWeek": 10, "hearingImpaired": false, "prefersSmallGroups": true },
  "contacts": [ { "id": "elaine", "name": "Elaine", "relation": "friend", "canDrive": false },
                { "id": "dan", "name": "Dan", "relation": "son", "canDrive": true } ]
}
```
Teammate B is replacing the activity catalog. If `fellowship` disappears, pick any step-free, large-group activity that has `family` and `paratransit` travel times within 30 minutes, and tell the lead.

## Screen layout (priority order)
1. **State banner (P0):** a big, colored state badge with one plain sentence, for example:

   | State | Sentence |
   |---|---|
   | `BLOCKED` | "Can't go yet: {blocker}" |
   | `PROPOSED` | "Here's what would make it work" |
   | `AWAITING_APPROVAL` | "Needs your OK before we contact anyone" |
   | `PENDING_CONFIRMATION` | "Waiting for replies" |
   | `READY` | "You're all set ✓" (green) |
   | `NEEDS_REPLAN` | "Something changed: here's a new plan" (amber) |
   | `COMPLETED` | "How did it go?" |

   Next to it, show the activity name and `plan.when`.
2. **Approval cards (P0):** one card per current action (`plan.actions` where `status !== "superseded"`). Each card shows:
   - **who** (map `scope.recipientId` to the contact name, or `"paratransit"` to "Paratransit service")
   - **what** (`description`) and **when** (`scope.when`)
   - **exactly what gets shared**: list `scope.sharedFields`, e.g. "Shares: name, pickup window, mobility"
   - **Approve** and **Withdraw** (`revoke`) buttons, plus the action status
   This consent screen is what proves the AI can't act without permission.
3. **Primary button (P0):** depends on the state. `PROPOSED`/`NEEDS_REPLAN` → **Accept plan**. `AWAITING_APPROVAL` → **Send requests** (`execute`). `READY` → **Mark as attended** (`complete`).
4. **Dependencies (P0):** a checklist from `plan.dependencies`. Show `requested` as a "⏳ Waiting" icon, never as booked. `confirmed` = ✓; `declined`/`cancelled`/`failed` = ✗ in red.
5. **Simulator panel (P0, clearly labeled "Demo: simulate replies").** These are buttons that POST to `/events`:
   - "Elaine accepts" → `{ type: "invite.accepted" }`
   - "Ride confirmed" → `{ type: "ride.confirmed" }`
   - "Ride cancelled" → `{ type: "ride.cancelled" }`
   - optionally "Elaine declines"

   Each body is `{ eventId: crypto.randomUUID(), requestId: action.providerRequestId, sequence, type, actor: "demo" }`. Keep a per-`requestId` counter for `sequence` (1, 2, 3…). Only enable a button when the matching action has a `providerRequestId`.
6. **Timeline (P1):** `events` from the GET, newest first, showing time, `type`, `actor` and `outcome`. Dim anything that's `duplicate`/`ignored`/`rejected` and show its `reason`. Judges love seeing "ride.confirmed ignored: stale or out-of-order", so add a hidden "Replay last event" button that resends the same body to show duplicates are ignored.
7. **Recovery (P1):** in `NEEDS_REPLAN`, highlight the new action (it needs a fresh approval) and show `plan.alternatives` as **Try instead** buttons (`choose_alternative`). Show `plan.blockers` if recovery isn't possible.
8. **Feedback (P1):** after `COMPLETED`, show signal chips ("Too crowded", "Too far", "Too expensive", "Loved it") → `feedback`. Render each `plan.preferencePatches` entry with status `proposed` as **"I heard: prefer small groups (was: off) [Confirm] [No]"**. After confirming, show "Preference updated (profile v{profileVersion})".
9. **Label (P0):** because `plan.dataSource === "mock"`, show a persistent "Simulated providers: no real messages or bookings are sent" badge. It has to be honest.

## The 60-second demo you're building for
Load demo → Accept → (show the consent cards) → Approve both → Send → "Elaine accepts" → "Ride confirmed" → **READY ✓** → "Ride cancelled" → **amber NEEDS_REPLAN, READY revoked, paratransit proposed, Elaine still confirmed** → Accept → Approve → Send → "Ride confirmed" → **READY ✓** → Mark attended → "Too crowded" → Confirm.

Rehearse this until it's smooth, and give Teammate B the click list for the pitch.

## Tips
- After every command or event, replace your state with `result.plan`, then GET to refresh `events` (or append `result.events`).
- Disable buttons while a request is in flight. The API is idempotent, but double clicks still look sloppy.
- Plans live in server memory: restarting `npm run dev` wipes them. That's fine; the demo button recreates one.
- Accessibility (same bar as A): 16–18px text or larger, 44px buttons, every button labeled, and color is never the only signal (pair it with ✓/⏳/✗ text).
- Before handoff: `npm run check`, then click through the 60-second demo twice in a fresh tab. Open a PR from `ui/coordination` and don't push to `main`.
