# DayBridge environment setup

All configuration lives in [`.env.example`](../../.env.example), which marks every variable
OPTIONAL / EXPERIMENTAL / PROPOSED and names the branch that reads it.

```bash
cp .env.example .env.local            # bash
Copy-Item .env.example .env.local     # PowerShell
```

Restart `npm run dev` after any change. Never commit `.env.local` (gitignored by `.env*`).
Anything without the `NEXT_PUBLIC_` prefix is server-only; `NEXT_PUBLIC_*` ships to the browser,
so it must never hold a secret.

## 1. Minimal local demo — no variables

`npm run dev` with an empty (or no) `.env.local`. You get seeded data, labeled mock AI
explanations, and coordination/sharing with in-memory stores. Nothing external is called.

To run the production build locally (`npm run build && npm start`) with coordination and
sharing still working, set `DAYBRIDGE_DEMO_EVENTS=1` and `SHARE_STORE=memory`. Local only.

## 2. Live AI (RunAnywhere)

Hosted (OpenAI-compatible):

```
AI_BASE_URL=https://inference.runanywhere.ai/v1
AI_MODEL=deepseek-v4.1-flash        # or glm-5.3-flash / mimo-v2.6-pro
AI_API_KEY=<your RunAnywhere key>
```

Local on-device (no key):

```
wally serve qwen3-4b-instruct-2507
AI_BASE_URL=http://127.0.0.1:8080/v1
AI_MODEL=qwen3-4b-instruct-2507
AI_TIMEOUT_MS=60000                  # CPU inference ~25s per explanation
```

If the AI call fails or times out, the app falls back to labeled mock explanations. AI only
explains; deterministic results come from `src/domain/`.

## 3. Live discovery (PR #11, not on main yet)

All off by default. Turn on per feature:

| Variable | Effect |
| --- | --- |
| `DAYBRIDGE_ENRICH=1` | Live enrichment in `/api/analyze` |
| `DAYBRIDGE_LUMA=1` | Luma public events |
| `GOOGLE_MAPS_API_KEY` | Google Places venue lookups (server-only) |
| `DAYBRIDGE_VENUE_PLACE_IDS` | JSON map of reviewed venue Place IDs |
| `UBER_API_TOKEN` | Uber price estimates (optional, fails soft) |

`DAYBRIDGE_EVENTS` was requested in review but no code reads it yet.

Need **no keys**: UC Berkeley public events feed, Open-Meteo weather, Google Calendar
template links, Uber/Lyft deep links.

Google Places requires: Places API (New) enabled, billing enabled, key restricted by API and
by HTTP referrer/IP, and Place IDs a human has checked against the real venue.

## 4. Cloud persistence (EXPERIMENTAL, PR #23)

`SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server-only), `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable key only). Only branch
`experiment/daybridge-cloud` reads them; it is not merged or approved for production. On main,
hosted coordination returns 503 and hosted sharing returns 503 (unless the demo flags above are set).

## 5. Vercel

| May set in Production | Must NOT set |
| --- | --- |
| `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS` | `DAYBRIDGE_DEMO_EVENTS` (opens simulated provider endpoints) |
| `AI_API_KEY` (mark Sensitive) | `SHARE_STORE` (in-memory store loses data across instances) |
| PR #11 discovery vars, once merged | `VERCEL` (set automatically) |
| | Any secret under a `NEXT_PUBLIC_` name |

Deploys are manual and need explicit approval (see `CLAUDE.md`).

## 6. Not implemented

- Email/SMS (`RESEND_API_KEY`, `TWILIO_*`): PROPOSED only. DayBridge sends no real messages.
- Payments: Stripe/payment execution is not implemented; no payment variables exist.

## Exact credentials a human must obtain

Only for the features you want. None are needed for the mock demo.

1. **RunAnywhere API key** → `AI_API_KEY` (hosted AI only; local wally needs none).
2. **Google Maps Platform API key** → `GOOGLE_MAPS_API_KEY`, plus **reviewed venue Place IDs**
   → `DAYBRIDGE_VENUE_PLACE_IDS` (PR #11).
3. **Uber server token** → `UBER_API_TOKEN` (optional, PR #11; access may be restricted).
4. **Supabase project URL, secret key, publishable key** → `SUPABASE_*` /
   `NEXT_PUBLIC_SUPABASE_*` (experimental, PR #23).

**`supabase db push` hangs or can't connect:** the direct host `db.<ref>.supabase.co` is IPv6-only, so IPv4-only networks can't reach it, and Supabase CLI v2.98 guesses the pooler host `aws-0-<region>`, while newer projects live on `aws-1-<region>`. Fix: after `npx supabase link --project-ref <ref>`, edit the gitignored `supabase/.temp/pooler-url` to `aws-1-us-east-1.pooler.supabase.com`, or pass the **Session pooler** string from Dashboard → Connect with `npx supabase db push --db-url "<string>"`. In Git Bash use forward-slash paths (`cd /c/Users/...`); backslashes are stripped.

## Dev tooling (not app config)

`scripts/demo-smoke.mjs` reads `BASE_URL` (default `http://localhost:3000`) and
`DEMO_ACTIVITY`. `scripts/pr-monitor` reads `GH_TOKEN`/`GITHUB_TOKEN`,
`DAYBRIDGE_REPOSITORY`, `DAYBRIDGE_POLL_MS`, `DAYBRIDGE_STATE_FILE`. Set these in your shell,
not `.env.local`.
