# DayBridge — Final Sprint Decision Addendum (2026-10-17)

**Priority:** P0 for Claude Opus 5.5 and all collaborators in the remaining hackathon sprint.
**Authority:** This is the working direction requested for the last sprint. It is **not** authorization to deploy publicly, spend money, send real messages, or bypass the existing merge/security review gates. In case of conflict, preserve the latest green `main` release and escalate actual product/security trade-offs.
**Read with:** `CLAUDE.md`, `AGENTS.md`, `docs/daybridge/DECISIONS.md`, `PR_ORCHESTRATION.md`, `PERSISTENCE_AUTH_PROPOSAL.md`, and the coordination contract. Re-check GitHub before claiming any PR is still open.

## Decision D1 — Hosted demo: optional stretch, NOT required for judging

- **Official demo:** the already-merged web golden loop on a local/single-instance server is the guaranteed, rehearsed fallback. Do not make a hosted URL a prerequisite for presenting DayBridge.
- **Parallel moonshot:** actively build a *secure* Supabase-backed Vercel-capable version now, isolated on `experiment/daybridge-cloud` (or a separate experiment branch/worktree if that exact branch already exists). This work should proceed concurrently with demo preparation, not block it.
- Cloud implementation P0 order: (1) atomic durable coordination store (plan, events, processed event keys and rev), (2) verified identity + owner authorization/RLS, (3) serverless-safe API, (4) cross-instance, concurrency and adversarial tests, (5) optional manual deployment after lead approval.
- Keep a memory-store adapter for localhost; fail **closed** for state-changing coordination routes in hosted production if auth or persistent storage is missing. Never let hosted production silently fall back to unauthenticated memory storage.
- No real outbound provider actions. Do not expose `DAYBRIDGE_DEMO_EVENTS=1` publicly or add a publicly accessible synthetic event-injection shortcut.
- **Hosted GO only if** durable across fresh instances/restarts, user isolation is proven, approvals/READY invariants preserved, CI/build/browser checks pass, secret hygiene confirmed, and the human lead explicitly approves deployment. Otherwise report cloud NO-GO and use local demo.

## Decision D2 — PR #12 onboarding: conditional GO before judging

- Try to incorporate the mobile-friendly swipe onboarding and improved dashboard **only in a candidate branch**, with the existing merged demo as rollback.
- Ownership remains with the UI teammate. Opus may review, request exact changes, integrate compatible code into an isolated branch, and coordinate cross-file contracts; don't overwrite the teammate's working branch without coordination.
- Gate: preserve a one-click **Load demo / Skip to plan** path, **Get me there →** from each valid match, and the exact `daybridge:profile` handoff so `/coordinate` uses the same profile instead of reverting to Maya.
- Maintain legible accessible mobile UI, touch target sizes, accurate simulated/live labels, consent cards, pending-vs-confirmed statuses, recovery and feedback; remove unrelated lockfile churn.
- Before promotion: `npm run check`, `npm run build`, `npm run demo:check` against a running candidate server, and two actual browser click-throughs on phone width and desktop. Test the real home → activity → `/coordinate` golden path.
- **If any gate fails near release freeze, defer PR #12 without guilt.** Keep current `main` or the last verified release. A visually impressive but broken onboarding flow is not acceptable.

## Decision D3 — Intake YES (thin slice), save/share YES as isolated stretch

### Intake P1: attempt now
- Implement the smallest useful natural-language caregiver intake: plain-language description → **suggested** typed profile/preferences → human review/edit/confirm → existing deterministic `/api/analyze` workflow.
- Start from the existing `Profile` Zod contract, avoid adding sensitive/diagnostic inferences, and never silently convert AI guesses into confirmed facts. Clearly label missing/uncertain fields.
- Keep deterministic demo profiles and manual form input fully functional when a model isn't available. If `/api/intake` uses an LLM, strictly validate its structured response; never let a language model decide consent, READY or feasibility.
- Assign a separate lead-approved file owner (e.g. `src/app/api/intake/**`, `src/lib/ai/intake/**`); UI partner only touches their assigned UI components. Build and verify on a separate feature branch. Promote only if no regression.

### Save/share P2: attempt in parallel; do not prematurely expose personal data
- Build a **read-only, intentionally shared snapshot** separate from mutable `/api/coordination/**` state. This may use `POST /api/plans` and `GET /plan/[id]` after a typed contract is frozen.
- A share snapshot must be opt-in and minimally redacted: omit contacts, approvals, raw feedback, private constraints, provider keys/tokens, internal IDs/event log and other personal data not explicitly approved. Use unguessable share capability/token, a way to revoke/expire where practical, and server-side validation. Share links confer **no command/approval permission**.
- Coordinate Supabase storage/auth with the cloud moonshot; do NOT build an unauthenticated public database endpoint or misleading 'share succeeded' UX.
- If persistence, redaction or authorization isn't ready, keep Save & Share disabled with an honest 'Not available yet' state; never convert a localStorage snapshot into a claimed publicly shareable link.
- A single optional redacted calendar/maps handoff is preferable to implementing unsafe messaging or booking.

## Execution order and parallelism — speed without collisions

1. **Protect baseline:** verify `main` (currently includes golden demo PR #19 and PR monitoring #8), reserve a known-good SHA, run local golden demo.
2. **Dispatch quickly:** Opus launches available independent subagents concurrently with frozen typed interfaces and one exclusive writer per file; never claim agents were launched if the environment can't launch them.
   - Lane A: PR #12 review/integration and browser golden-path regression (UI teammate owns actual UI edits).
   - Lane B: consent-safe natural-language intake (lead/assigned engineer owns intake backend, UI teammate owns UI integration).
   - Lane C: read-only snapshot save/share contract and guarded prototype, independent of mutable coordination state.
   - Lane D: cloud Supabase store/auth/API/invariants in its own **worktree and PR** (separate cloud lead if possible).
   - Lane E: GLM adversarial tests / browser and HTTP regression against each candidate.
   - Lane F: GPT Work independent privacy, access-control, CI and release-review evidence.
3. **Parent Opus:** own integration order, non-overlap, contract decisions, review comments, branch/test receipts and release-candidate recommendations. Don't rebuild the coordination engine or build a second monitor.
4. **Merge promotion:** prefer a verified small candidate over a large partial integration. Work in feature branches/PRs; respect the merge authorization already in `DECISIONS.md` and stricter lead approval for big technical decisions. Do not merge the cloud experiment into main without explicit lead sign-off.
5. **At freeze:** stop feature integration, check `npm run check`, `npm run build`, `npm run demo:check` plus manual browser end-to-end flows; preserve locally runnable fallback and backup recording.

### Feature promotion order
P0 reliable existing golden demo → P1 safe #12 onboarding *if gates pass* → P1 thin intake *if gates pass* → P2 save/share *only when safely private/redacted* → secure cloud hosting *only when auth and durable store pass* → P2 optional integrations → **no native iOS build in this sprint**.

### Required final report
One concise update with: deployed/not deployed status; current main and last-known-good SHA; each lane's branch/PR and owner; tested/untested evidence; accepted features versus deferred ones; cloud security verdict; next exact commands; and any decisions still requiring explicit human approval.

**Do the work in parallel, not sequential planning. The objective is the maximum number of verified useful features without ever losing the reliable golden demo.**
