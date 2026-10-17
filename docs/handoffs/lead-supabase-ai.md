# Handoff: Lead, Supabase and AI

Read [README.md](README.md). Branch: `git checkout -b supa/save-share` (and `ai/intake`, or one branch for both).

## You own
- `src/lib/ai/**`: `adapter.ts` (live explanation) and a new `intake.ts`
- `src/app/api/intake/**` (new), `src/app/api/plans/**` (new)
- `src/app/plan/[id]/**` (new read-only shared plan page)
- `src/lib/supabase.ts` (new), `supabase/migrations/**` (new)
- `.env.example` (add new variable names, never values)

UI hookup (the textarea and the Save button) belongs to Teammate A. Give them the endpoint shapes below.

## The AI that already works
- `src/lib/ai/adapter.ts`: `liveAdapter` calls any OpenAI-compatible `${AI_BASE_URL}/chat/completions`. If it fails or times out (20s), `/api/analyze` falls back to the mock and labels the result `dataSource: "mock"`.
- Local, on-device model through RunAnywhere:
  ```bash
  wally models pull qwen3-4b-instruct-2507     # one-time, 4 GB (already done on the lead laptop)
  wally serve qwen3-4b-instruct-2507           # → http://127.0.0.1:8080/v1
  ```
  `.env.local`: `AI_BASE_URL=http://127.0.0.1:8080/v1`, `AI_MODEL=qwen3-4b-instruct-2507`, `AI_TIMEOUT_MS=60000` (the CPU runs about 8 tok/s, so a live explanation takes 20–30 s; consider streaming it or showing the mock first and swapping in the live text).
- Hosted fallback: `wally opencode --cloud` uses RunAnywhere Cloud credit ($5.05 on the account). Check spend with `wally account usage`.

## Task 1: Plain-words intake (AI, P1)
A caregiver types "Mom loves gardening and music, uses a walker, doesn't drive, I can drive her Saturdays, free afternoons, hard of hearing", and the form fills itself.
- `POST /api/intake` with `{ text: string }` → `{ profile: Profile }` or `400/502 { error }`
- In `src/lib/ai/intake.ts`, call the same endpoint as `adapter.ts`:
  - with a system prompt that lists the allowed enum values from `schema.ts`;
  - asking for **JSON only**;
  - with `temperature: 0`;
  - with `response_format: { type: "json_object" }` if the server supports it, otherwise extract the text between the first `{` and the last `}` in the reply.
- Validate with `Profile.safeParse`. If a field is missing, fill a safe default (for example `maxTravelMin: 30`, `budgetPerWeek: 10`) and **then** validate. If it still fails, return an error; the UI keeps the manual form.
- Add a vitest with a stubbed `fetch` for: valid JSON → profile, garbage → error.
- The AI only *understands* the text. The deterministic engine still makes the plan.

## Task 2: Save & share (Supabase, P1)
The project already exists: ref `bbvapuwrcvbrzqghwwyo`, URL in `.env.example`.
```sql
create table plans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile jsonb not null,
  result jsonb not null
);
alter table plans enable row level security;
-- No user accounts in the demo: anyone with the link can read the plan, and only the server can write.
create policy "public read by id" on plans for select using (true);
```
- `POST /api/plans` with `{ profile, result }` → `{ id }`. Insert from the server using `SUPABASE_SECRET_KEY` (server-only, never `NEXT_PUBLIC_`). `npm i @supabase/supabase-js` is pre-approved.
- `/plan/[id]`: a server component reads the row and renders the plan read-only (reuse Teammate A's plan card components) with a "Shared by DayBridge" header. Hide the person's name if you want extra privacy.
- Store the migration in `supabase/migrations/` so it can be reproduced.
- Stretch (P3): an "I went ✓" check-in per activity (`checkins` table), so a family member sees attendance.

## Task 3: Demo reliability (P2)
- Before judging: start `wally serve` once and send a warm-up request (the first call is slow).
- If the local model is too slow on the demo laptop, point `AI_BASE_URL` at a hosted endpoint or leave it unset. The app still works with the mock, and the badge stays honest.
