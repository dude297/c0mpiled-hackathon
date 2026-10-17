# Share contract — opt-in, redacted, read-only plan snapshot

Status: demo store (in-memory). Source: `src/lib/share/share.ts`, routes `src/app/api/plans/**`, page `src/app/plan/[id]/page.tsx`.

## POST /api/plans

Request (strict; unknown keys → 400, body over 200,000 chars → 413):

```json
{ "result": AnalysisResult, "consent": true, "firstNameOnly": false, "expiresInDays": 7 }
```

- `consent` must be the literal `true`.
- `firstNameOnly` (optional, default false): show the first name parsed from the engine's own summary templates. Otherwise the plan says "Someone".
- `expiresInDays` (optional, integer 1..30, default 7).
- **Never send the profile.** The current UI payload `{profile, result}` is rejected with 400.

Responses:

| Status | Body |
|---|---|
| 201 | `{ id, url: "/plan/<id>", revokeToken, expiresAt }` |
| 400 | `{ error }`: missing consent, bad shape, or extra fields |
| 413 | `{ error }`: body too large |
| 503 | `{ error }`: sharing not available (production without `SHARE_STORE=memory`). UI: show "Not available yet" |

`revokeToken` is returned only once. The UI keeps it, for example in the creator's sessionStorage.

## DELETE /api/plans/:id

Header `Authorization: Bearer <revokeToken>`. 204 on success. Unknown id, wrong token or missing token → 404 (the two cases cannot be told apart). 503 as above.

## GET /plan/:id (page)

A read-only server page with `noindex, nofollow`. An expired, revoked or unknown id returns an HTTP 404 not-found page. The footer says "Demo link — valid while this demo server is running" and labels the AI source. The AI explanation itself is never shared.

## Redaction: allowlist only

Nothing in the client payload is copied verbatim. The snapshot is rebuilt from:

| Field | Source |
|---|---|
| `items[].name`, `when`, `costPerWeek` | Catalog (`ACTIVITIES`) lookup by `activityId`. Unknown or duplicate ids are dropped, at most 7 items |
| `items[].travel` | Mode bucket only: `drive` / `bus` / `walk`. `paratransit`, `family` and anything else → `"arranged ride"`. No minutes |
| `items[].tips` | A fixed generic tip per soft-barrier rule (`access`, `transport`, `hearing`, `social`). Barrier detail and mitigation text are dropped |
| `summary` | Rebuilt: "<displayName>'s plan for this week: N activities." |
| `displayName` | `"Someone"`, or the first name only when `firstNameOnly` is set and it parses from the summary (letters, `'`, `-`, up to 30 chars) |
| `dataSource` | Copied (`mock`/`live`) for the AI label |

Dropped entirely: profile, explanation, evidence, blocked, items/labels, scores, and barrier text.

## Store and security

- id: 128-bit random (`randomBytes(16)`, base64url, 22 chars). The revoke token is a separate 256-bit random value. Only its SHA-256 is stored, and it is compared with `timingSafeEqual`.
- In-memory `globalThis` map, capped at 1000 entries. Expired entries are pruned first, then the oldest entries are evicted. Lost on restart and not shared across serverless instances.
- Production fails closed: 503 unless `SHARE_STORE=memory` is set explicitly.
- Before real use, replace the store with a DB table (same contract) and add rate limiting.
