# Intake contract (D3, thin slice)

Plain-language caregiver text → **suggested** `Partial<Profile>` → caregiver reviews/edits/confirms in the UI → existing `/api/analyze`.
The server never runs the planner and never marks anything confirmed.

## `POST /api/intake`

Request: `{ "text": string }` (trimmed, 1..2000 chars). Anything else → `400 { error }`.

Response `200`:

| field | meaning |
|---|---|
| `suggestion` | `Partial<Profile>`. Each key validated with `Profile.shape[key].safeParse`; unknown keys never copied; arrays deduped. |
| `confirmedFields` | Always `[]`. Confirmation happens only in the UI. |
| `uncertain` | Profile keys not stated or invalid. UI must highlight these. |
| `notes` | `"I heard: <key> = <value>"` lines for display. |
| `source` | `"llm"` or `"rules"`. |
| `dataSource` | `"live"` only when `source` is `"llm"`, otherwise `"mock"`. |

## Paths

- **Rules** (`src/lib/ai/intake/parse.ts`): offline, deterministic regex parser. Extracts interests (enum synonyms), mobility (wheelchair > walker > cane > full), transport (negation-aware; "I'll drive her" → family), times, maxTravelMin, budgetPerWeek (only `$N`/`N dollars` per week), hearingImpaired, prefersSmallGroups, and a name only when capitalised in the original text and not a relation word (Mom/Dad → uncertain). Diagnoses and medications are ignored.
- **LLM** (`src/lib/ai/intake/intake.ts`, only when `AI_BASE_URL` is set): OpenAI-compatible, JSON-only prompt listing enum values, temperature 0, 15 s timeout, `<think>` stripped, JSON taken between the first `{` and last `}`, replies over 4000 chars rejected, per-field validation, `name` dropped unless it appears literally in the text. Any failure → rules. Rules fill keys the LLM omitted.

## UI obligations

Prefill the form from `suggestion`, highlight `uncertain`, show `notes` + `dataSource` badge, and require an explicit **Confirm** before calling `/api/analyze`. Never auto-run.
