# Handoff: Caregiver Dashboard UI

**For:** the UI teammate. **API contract:** `docs/daybridge/CAREGIVER_DASHBOARD_CONTRACT.md` (types, endpoints, errors, fixtures, curl walkthrough). **Backend:** `feat/caregiver-backend`. Check that doc's Status column. Code against IMPLEMENTED rows only, and treat PROPOSED rows as subject to change.

## Ownership

| Area | Owner |
|---|---|
| `src/app/caregiver/**` (all pages, layouts, loading/error files) | **UI teammate** |
| `src/components/caregiver/**` | **UI teammate** |
| `src/app/api/caregiver/**`, `src/domain/caregiver/**` | Backend (`feat/caregiver-backend`). Don't edit; ask for changes |
| `src/lib/schema.ts`, coordinator, existing `/coordinate` and `/` pages | Not part of this work. Don't edit |

Reuse `src/components/ui/*` (button, card, badge, textarea). Add no new packages.

## Local setup

1. `npm run dev`.
2. Seed with `curl -X POST localhost:3000/api/caregiver/demo -H "x-daybridge-user: cg-dana"`. The response returns person and plan ids.
3. The UI sends the `x-daybridge-user` header on every call. For the demo, add a small "Viewing as" picker on the dashboard (cg-dana / cg-lee / self-maya) and store the choice in `localStorage`. Label it **"Demo identity (not sign-in)"**. Never present it as login.

## Screens

### 1. Overview list (`/caregiver`)
- `GET /overview`. One card per `PersonSummary`. Show:
  - display name
  - next activity: name, slot, and `nextDate` formatted in the person's timezone, with the timezone shown when it differs from the browser's
  - plan state as a plain-language badge
  - attention count (a badge, but not red when it is 0)
  - latest check-in kind and relative time, with a **Self** or **Caregiver** tag
- `nextActivity: null` → "No upcoming activity". `latestCheckIn: null` → "No check-ins yet". Neither one is an error.
- Empty `people` → "No one shared with you yet." Use the same text for a revoked user: never hint that someone exists.

### 2. Person detail (`/caregiver/[personId]`)
- `GET /people/:id`. Sections in this order: Needs attention, Upcoming, Plans, Recent check-ins (5), then a link to History.
- Each plan row shows the state, then each dependency with its **own** status, then the outcome if present.
- Actions are gated by `myScopes`:
  - Check in (`checkin`, or the caller is self)
  - Acknowledge (`view`)
- Hide the controls the caller can't use. Still handle a 403 if one gets through.
- Check-in notes: if an item has `hasNote: true` and no `note`, show "Note (visible to the reporter and managers)". Don't render it as an empty note.

### 3. Check-in form
- Three large buttons, each one sends the check-in:
  - **I'm OK / They're OK** (`ok`)
  - **Please call** (`call`)
  - **Need help** (`help`)
- Use first-person copy when the caller is self, and third-person otherwise.
- Optional note textarea, **max 280 characters**, trimmed, with a live counter. The `maxLength` attribute alone isn't enough: show the count.
- Generate one `idempotencyKey` (`crypto.randomUUID()`) per form open and reuse it on retry, so a double-tap or retry can't create two check-ins. Generate a new key after a success.
- 201 → "Check-in saved". 200 with `duplicate: true` → "Already saved" (not an error). 409 → "That check-in was already sent with different details. Reload and try again."
- Help copy under the buttons: **"This records a check-in. It doesn't contact anyone or change any plan."** A check-in never touches plan state.

### 4. Attention list
- Show the items from person detail (or aggregated across people). Each item shows the title, detail, time and an **Acknowledge** button.
- Acknowledge → `POST /attention/:itemId/ack`. On success the item **stays** in the list, marked "Acknowledged by you". Don't remove it, strike it through or call it "resolved". Acknowledging only means "I've seen this". Only the underlying change (approval, confirmation, a later OK check-in) clears an item.
- Kinds:
  - `help_requested`: highest emphasis
  - `call_requested`
  - `approval_needed`: link to `/coordinate`; approvals happen there, not here
  - `confirmation_pending`
  - `plan_disrupted`
  - `checkin_overdue`

### 5. History (`/caregiver/[personId]/history`)
- `GET /people/:id/history?limit=20`. List newest first.
- A **Load more** button sends `cursor=<nextCursor>` and appends the results. Hide the button when `nextCursor` is null. Never parse or build cursors.
- Group by day in the person's timezone. Use an icon or tag per `type`: plan, ride/invite, attendance, feedback, check-in.

## Honesty labels (required)

| Label | Where | Text |
|---|---|---|
| `labels.storage === "memory"` | Persistent footer or banner on every caregiver screen | "Demo storage: data resets when the server restarts." |
| `labels.storage === "durable"` | Same place | "Saved" (or no banner) |
| `labels.providers === "simulated"` | Next to any ride/invite status | "Simulated: no real ride or invite was sent." |
| Dependency `requested` | Plan rows | "Requested, not confirmed yet". **Never show `requested` as confirmed**, and never use a check mark for it |
| Dependency `confirmed` | Plan rows | "Confirmed" (with "simulated" while providers are simulated) |
| `outcome.source === "self_reported"` | Plan rows | "Attended (self-reported)". Keep it separate from the dependency statuses |
| `reporterRole` | Every check-in | **Self** ("Maya checked in") vs **Caregiver** ("Dana checked in for Maya"). Use different wording and a tag; don't rely on color alone |

**Unknown stays unknown:** when there's no schedule, show no overdue text and no "on track" text. Show "No check-in schedule set". Missing data shows "Unknown" or "Not set", never a guess.

## Error and unavailable states

| Status | UI behaviour |
|---|---|
| 401 | "Choose a demo identity to continue". Open the identity picker |
| 403 | Inline, at the action: "You can view but not do this. Ask a manager for access." Keep the page |
| 404 | Full-page "Person not found or not shared with you." It reads the same whether the person doesn't exist or isn't shared. Link back to the overview |
| 409 | Show the `error` message from the response inline |
| 503 | Full-page "The caregiver dashboard is available in the local demo only. It needs sign-in and storage." No retry loop |
| Network / 5xx | "Couldn't load. Retry." Keep the last good data on screen with a "may be out of date" note |

Show loading skeletons or "Loading…" text, never a blank screen. Disable buttons while a request is in flight.

## Accessibility

- Use one `h1` per page and real `button` and `a` elements, with visible focus (`focus-visible:ring-3`, matching the existing pages).
- Tap targets ≥ 44px (`min-h-11`). Body text ≥ 16px. The check-in buttons are larger still: this is an older-adult surface (self).
- Status is never shown by color alone. Pair every badge with text and an icon.
- Announce save results, errors and ack results through an `aria-live="polite"` region. Errors use `role="alert"`.
- Give the note counter an `aria-describedby` link to the textarea. Over the limit, announce "N characters over".
- Dates use full readable text ("Sunday, October 18"), with an `aria-label` that includes the timezone.
- Load more moves focus to the first new item.
- Respect `prefers-reduced-motion`.

## Definition of done (UI)
- [ ] Dana sees Maya and Margaret, and Lee sees only Margaret.
- [ ] Lee opening Maya's URL gets the 404 page.
- [ ] A self check-in and a caregiver check-in are visibly different.
- [ ] Acknowledging an item keeps it visible as "Acknowledged by you".
- [ ] `requested` dependencies never look confirmed. The memory and simulated labels are visible.
- [ ] Load more pages through the history.
- [ ] Each state works: 401 (no identity), 403 (Lee checking in) and 503 (production build without the flag).
