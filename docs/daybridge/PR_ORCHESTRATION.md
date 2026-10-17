# DayBridge — Opus PR Orchestration & Agent Review Protocol

**Effective 2026-10-17.** This document supersedes any earlier description of Opus as *only* the backend-engine author. The coordination engine already exists on [PR #3](https://github.com/dude297/c0mpiled-hackathon/pull/3); Opus must now shift to **integration maintainer and review orchestrator**.

## 1. Assignment and authority

- **Opus = integration captain:** inspect *all* open PRs targeting `main` (including PRs by people and other models), inspect diffs/checks/reviews, detect scope conflicts, review contracts and tests, sequence/rebase/retest merges, and leave actionable GitHub review comments. Opus should request changes openly from Teammate A/B, GLM, GPT Work, or the lead **when evidence warrants it**, without rewriting their assigned files.
- **Lead = approval owner:** Opus may recommend merges, manage the merge queue, and **execute a merge only once the human lead has authorized that PR or a clearly named batch**. Approval must be explicit; passing CI alone is not approval. No automatic merge just because a branch is green.
- **No deployment authority:** merging `main` is not permission to deploy, connect Vercel/Netlify, expose APIs publicly, spend on providers, or change credentials. Preserve `vercel.json` protections.
- **GPT Work = independent PR/security auditor:** validate integration gates, review fresh diffs, challenge model claims and add owner-tagged review suggestions.
- **GLM-5.3 Flash = independent regression and fault-injection verifier:** on coordinator changes, update the simulator/tests and post any reproducible failures in the relevant PR. Do not rebuild Opus's engine.
- **Human Teammate A:** owns UI and API wiring in the UI.
- **Human Teammate B:** owns real activity data, third-party connectors/handoffs, and demo/pitch.
- **Lead:** owns Supabase, local AI, secrets, auth/security decisions, merges approval and deployment.

## 2. Required Opus PR triage (every session and after relevant changes)

1. Enumerate **all open PRs with base `main`**, not only the PR number provided in a prompt. Read changed files, commits, review discussions, requested-changes status, check runs and current mergeability.
2. Classify each PR as **READY TO REVIEW / CHANGES REQUESTED / BLOCKED / APPROVED TO MERGE / MERGED**. Distinguish *code review approval* from *lead authorization to merge*.
3. Look for competing edits, schema/API drift, fixture vs production behavior, unsupported security assumptions, regressions, tests that exercise copied helper logic rather than the real implementation, and undocumented live network side effects.
4. Comment on the **specific PR**, preferably inline on a precise file/line when useful. Avoid general criticism without an actionable change.
5. When a change is needed in another owner's file, request it in a comment with the owner named, expected interface, acceptance test and priority. Do **not** silently edit or cherry-pick over their branch.
6. Before a proposed merge, integrate the **candidate combination** (not only isolated PR tests) in a throwaway branch/worktree and run `npm run check` and `npm run build`, plus the offline golden path and adversarial consent/READY scenarios.
7. Obtain explicit lead approval for the PR or named batch. Then Opus may perform the merge in the agreed order, verify actual `main` SHA and repeat necessary checks. If approval unavailable, leave the PR ready and give a precise approval request.
8. After a merge, post a concise integration handoff, next PR dependency and remaining blocker. Never imply tests passed unless personally run or link to an existing trustworthy check.

## 3. Current queue (snapshot, re-check before acting)

- **PR #1 — docs / roles / instructions:** integrate as the source of truth after inspecting whether the latest changes conflict. Includes this orchestration policy.
- **PR #3 — coordination engine:** core contract exists; review the full diff and tests. The author reports 39/39 tests and passing production build. Local memory and missing authentication are **deployment blockers**, not proof of a public-ready app. Separate proof from author claims. No duplicated coordinator implementation.
- **PR #2 — simulation Phase 1:** regression suite is reported passing. GPT Work PR #4 raised concern that some tests may use copied planning logic; Opus/GLM should verify production `runScenario` is being exercised. After PR #3 merges, GLM adds coordination fault injection against its exported `ProviderPort`.
- **PR #4 — GPT Work audit:** the existing audit was captured before the new coordinator PR was integrated; its NO-GO/missing-engine statements are **time-scoped**. Request a **delta review of PR #3** and update the final gate against the merged candidate before relying on it.
- **UI/data integration:** separate teammate branches may not yet be PRs. Invite the owners to open narrow PRs; do not assume they are absent or finished.

**Suggested dependency order:** Docs (#1) → coordinator (#3) → simulator (#2 and follow-up) → UI and real integrations → refreshed audit (#4 or follow-up), adjusting for human review and actual branch dependencies. This is a queue suggestion, **not authorization to merge anything**.

## 4. GitHub comment protocol — the shared asynchronous mailbox

Use a top-level or inline PR comment, labeled clearly in the body:

```text
[DAYBRIDGE][OWNER:OPUS|GLM|WORK|UI|DATA|LEAD][PRIORITY:P0|P1|P2][TYPE:BLOCKER|REQUEST_CHANGE|QUESTION|FYI]
Issue: <specific observation and file/line or command>
Requested action: <one concrete change or decision>
Acceptance: <how we will verify it>
Dependency: <other PR/contract if relevant>
```

Replies should start `[DAYBRIDGE][ACK]`, `[DAYBRIDGE][BLOCKED]`, or `[DAYBRIDGE][RESOLVED]`, and include a commit/test link. **These tags are conventions, not GitHub @mentions or real push notifications.** Mention an actual GitHub account only if its identity and notification rules are known.

**One reviewer owns each finding.** Duplicate bots should not repeatedly post the same request. On conflicting reviews, Opus proposes a resolution, but the human lead decides scope-changing/product choices. Avoid automatic model-generated merges and self-approval loops.

## 5. Monitoring and background limitations

- **While an agent session is active:** Opus should check open PRs and new discussion changes after each substantial integration step; GPT Work and GLM should check for new comments/reviews at least once at session start and again before completing their PR or report. A 5-minute read-only poll *while actively working* is acceptable if the runtime supports long-lived processes.
- **Between sessions:** a model is not a persistent process by default. Do not claim GPT Work or GLM is monitoring 24/7 unless a separate scheduler/runtime was actually configured. An hourly ChatGPT condition watch can alert the human lead, but it does **not** run GPT Work or GLM.
- **GLM local option:** use an authenticated, read-only `gh api` poll in a maintained development terminal or a dedicated scheduled process; retrieve both issue/PR conversation comments and inline review threads. Read `GITHUB_TOKEN` from environment only; never commit it. If no trusted long-running host is available, check once at the beginning/end of each session.
- **GPT Work option:** if Work offers a persistent/scheduled task in the user's account, configure it from Work, reading this repo and responding to new owner-tagged comments. Otherwise, perform start/end-of-session checks and rely on the lead's hourly alert.
- **No automatic replies or mutations from a comment watcher:** present proposed response/patch for review, then let the assigned agent post it in its active session. Stop polling on API failures/rate limits rather than hammering GitHub.

## 6. Gate for merging to main

**Mandatory:** correct ownership, exact scope, no known regression, typecheck/lint/unit tests, integrated production build, event replay/READY/approval invariants, no secrets, distinguish live/mock evidence, and explicit lead approval.

**Mandatory before any hosted release:** persistent storage or an explicitly single-instance guarantee, authentication/authorization for plan IDs and commands, provider secret protection, production demo-event routes disabled, expected rollback path, and explicit deployment approval.

**No busywork:** Opus should prioritize unblocking the next reviewable integrated slice. Do not rewrite completed work merely to match a preferred architecture.
