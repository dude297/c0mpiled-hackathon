# DayBridge PR operations

Owner: Work (monitoring/independent QA). Primary integration orchestrator: Opus. Human lead retains merge, release and deployment authority. No monitoring action merges code, changes hosting, dispatches application providers or contacts agents directly.

## Responsibilities and review order

| Owner | Files / responsibility | Required handoff |
|---|---|---|
| Opus | `src/domain/coordination/**`, `src/app/api/coordination/**`, additive `src/lib/schema.ts`, coordination contract; primary integration orchestration | Freeze interface, reconcile dependencies, assemble integration candidate, request file-owner reviews |
| GLM | `src/simulation/**`, simulation guide; independent regression/failure tests | Exercise production/public interfaces with synthetic fixtures; report exact results and uncovered cases |
| Human A | `src/app/page.tsx`, layout/styles, `src/components/**`; all UI wiring | UI handles command outcome/reason, current state, pending confirmations, cancellation and feedback review |
| Human B | `src/domain/activities.ts`, `src/integrations/**`, dedicated integration handlers; activity evidence, third-party connections and demo preparation | Provenance, offline fallback, provider-port compatibility; coordinate existing `src/lib/integrations/**` discrepancy with lead |
| Human lead | Supabase, local AI/intake, secrets, architecture, release/deployment | Persistence/auth decisions, runtime evidence, final merge/release approval and rollback control |
| Work | `scripts/pr-monitor/**`, monitoring/CI workflows, operations docs and independent audit | Maintain monitoring, test dedup/security, independently inspect implementation and integration evidence |

This user-authorized operations scope supplements the earlier docs-only Work assignment. The Opus-only subagent directive in PR #1 does not reassign other owners' files. One owner per file; ask for an interface change rather than editing another workstream.

Main's `PR_ORCHESTRATION.md` remains the orchestration policy: status comments here are the narrow monitoring output authorized by this task, not automatic agent replies, patches or interpretation of comment commands. It uses `[DAYBRIDGE][OWNER:...][PRIORITY:...][TYPE:...]` requests and `[DAYBRIDGE][ACK|BLOCKED|RESOLVED]` responses; use those tags with the SHA/proof convention below. Main also contains a new Teammate C UI handoff, while this task assigns UI to A; lead/Opus must reconcile that assignment before concurrent UI writes. This monitor keeps A as the responsible UI role rather than inventing a new assignee.

1. Open a narrow PR from approved main; include exact base/head SHA, owned paths, implemented vs simulated behavior, checks, unresolved blockers and next owner. PR #1 defines scope; #2 is baseline tests; #3 is coordination core; #4 is the historical audit. See [the updated independent audit](INTEGRATION_QA_REFRESH.md) before relying on #4's old absence claims.
2. Opus reviews dependencies and requests the responsible file owners. New shared contracts need explicit A/B/GLM/lead acknowledgment at a named version and SHA. `schema.ts`, ProviderPort, coordination endpoints and `COORDINATION_CONTRACT.md` trigger contract notifications.
3. Require `app-check`, `app-build`, `monitor-tests`, no unresolved review threads, no `blocked`/`do-not-merge`/`needs-contract` label, a clean non-draft merge state and a current-head approval from a different trusted collaborator/member/owner. Missing checks, unknown merge state and truncated API history all withhold automatic readiness.
4. Opus assembles and checks an integration candidate. Passing each feature branch separately does not prove their combination. Human lead authorizes merges/releases; monitor readiness is advisory and cannot override human review or application safety gates.

The new `DayBridge CI` workflow runs checks on PRs and main pushes with read-only token permissions and no repository secrets. It uses Node 24 and the locked install with lifecycle scripts disabled. No dependencies are added. App-check runs `npm run check`; app-build runs `npm run build`; monitor-tests runs the independent Node test suite. The monitor never publishes success statuses itself. Existing application tests may use synthetic/local fallback requests; no provider/AI secrets are supplied by CI.

An administrator must separately configure these exact check names as required in branch protection/rulesets if enforcement is desired. This PR does **not** change repository settings. All current workstreams use the same GitHub author account, so approval by that author is not independent and does not make the monitor mark a PR ready. Obtain a distinct authorized reviewer or retain an explicit manual lead decision; the monitor does not fabricate approval.

## Conflicts and contract changes

- When GitHub reports `CONFLICTING`, Opus identifies the file owners and asks one person to resolve each shared area. Bring the approved base into the feature branch; do not use blanket “ours/theirs,” rewrite unrelated owners' code or force-push over their work.
- Recheck the resolved diff, compare API schemas/examples, rerun all required checks and renew approval on the resulting SHA. `BEHIND`, `UNKNOWN` and `UNSTABLE` are not clean integration readiness.
- Use additive schema changes; preserve `Profile`, `ScenarioInput`, `AnalysisResult` and `/api/analyze`. Coordination uses `/api/coordination/**`; lead's save/share keeps `/api/plans`. Do not substitute a TypeScript cast for runtime validation.
- A breaking contract PR carries `needs-contract` until affected owners acknowledge the version and examples. Removing the label requires proof links, not just a successful compile. Monitor reports label removal; Opus verifies it.
- Review overlapping PR diffs before assembling the candidate. The integration branch already contains UI ancestry; integrate it once. Do not duplicate shared commits through repeated cherry-picks.

## Durable GitHub monitoring

`.github/workflows/pr-monitor.yml` reacts to PR open/commit/state/label/reviewer events, submitted/edited/dismissed reviews, inline and conversation comments, pushes, completed `DayBridge CI` runs, external check runs and commit statuses. A five-minute scheduled reconciliation and manual dispatch recover missed/queued signals and merge-state computation. GitHub does not support an Actions `pull_request_review_thread` trigger; thread resolution is detected during the next snapshot refresh (local refresh or scheduled reconciliation). Scheduled runs can be delayed; no eight-second hosted SLA is claimed.

The write-capable job checks out **only the trusted default branch**, with checkout credentials disabled; it never executes PR-head code, downloads PR artifacts, evaluates comment instructions or uses user text in shell commands. Review/inline events first run `pr-review-signal.yml`, a no-checkout, no-permission job; its completion wakes the trusted `workflow_run` monitor. That consumer reads GitHub directly and trusts no signal-job output or artifact. It uses the built-in `GITHUB_TOKEN`: contents/checks read and pull-requests write for the status comment. No PAT, cloud computer, new paid service or repository secret is required for hosted monitoring. If Actions policy denies a comment write, the job fails visibly and later trusted reconciliation can retry after policy is corrected by the lead. Fork workflows may require approval before a signal runs; scheduled reconciliation remains the fallback.

Output is one bot-authored updatable status comment per PR plus the Actions run summary. It identifies PR number, changed event, responsible role and next action. It does not copy human comment bodies or ping users/teams. Bot/marker comments are ignored before API access; the latest normalized snapshot is encoded in the status comment to deduplicate reruns. A repository-wide concurrency group serializes writes. Queued GitHub events can coalesce: this is a current-state monitor, not an immutable event ledger. It reconciles the latest state after a missed run; it does not promise to report every short-lived intermediate state.

Bot comment **edits may not notify subscribers**. Normal GitHub notification delivery depends on each user's subscription settings. Agents must explicitly read comments; no Opus/GLM chat bridge is configured or tested. The optional local watcher prints transitions during a session. This implementation does not rely on a ChatGPT cloud computer remaining alive.

Activation: the human lead reviews and merges this installation to the default branch. Before then, the monitor's trusted checkout deliberately reports “activation pending” rather than running feature-branch code with write access. After merge, run **Actions → DayBridge PR monitor → Run workflow**, inspect its summary/status comment, then submit a real test review/comment and verify one update and no follow-up loop. No deployment is involved. Hosted end-to-end delivery is unverified until that activation test completes.

## Optional local watcher — Windows PowerShell

From a repository checkout containing this PR, with Node 24 and GitHub CLI installed:

```powershell
gh auth login --hostname github.com
$env:DAYBRIDGE_REPOSITORY = 'dude297/c0mpiled-hackathon'
$env:DAYBRIDGE_POLL_MS = '8000'
node scripts/pr-monitor/monitor.mjs --once
node scripts/pr-monitor/monitor.mjs
```

The watcher uses `GH_TOKEN`, then `GITHUB_TOKEN`, then the token returned privately by `gh auth token`. Prefer CLI credential storage. Never paste a token into source, issue comments, a committed env file or a command-line argument. Fine-grained read credentials need repository metadata, pull-request and check/status access; no admin/workflow-write/deploy permission is needed for local monitoring. GraphQL access must be allowed for the chosen account. It performs GETs and GraphQL reads only and never posts comments. Invalid/expired auth fails without logging the token or API response body.

Configuration: `scripts/pr-monitor/config.json` defines required checks, contract paths, blocking labels and path-to-role routing. `DAYBRIDGE_POLL_MS` accepts 8000 or greater. Optional `DAYBRIDGE_STATE_FILE` selects another local state/lock path. Eight seconds controls the conditional REST PR inventory; changed PRs get an immediate aggregate GraphQL snapshot. Otherwise review threads/checks refresh at most once per minute per PR, slowing further for large inventories. At four unchanged PRs this is about 450 conditional inventory reads and 240 detail queries/hour; properly authorized 304 responses save primary REST budget, while GraphQL has its own budget. Restarts discard HTTP cache but retain normalized snapshots and dedup keys.

The client uses ETags on GETs, serial request pacing, 20-second request cancellation, remaining/reset headers, `Retry-After` (seconds/date), exponential failure backoff with jitter and a fixed API origin with redirects disabled. Low budget postpones work; no spin retry. Reports may arrive later than eight seconds under rate limits or network failure.

Pause: press **Ctrl+C**; the in-flight request/sleep is aborted and state saved. Restart with the same command to resume deduplication. Closing the terminal or killing the process forcibly may skip final cleanup; state was also saved after successful polls. A PID lock prevents two watchers from writing the same state. Dead-process locks recover automatically; Windows PID liveness failures fail conservatively.

Recovery:

```powershell
# After verifying no watcher process still runs:
Get-Content .daybridge-monitor/state.json.lock -ErrorAction SilentlyContinue
# Inspect that PID in Task Manager before removing a leftover/invalid lock.
Remove-Item -LiteralPath .daybridge-monitor/state.json.lock -ErrorAction SilentlyContinue
# If state is corrupt, retain it for inspection, then reconcile afresh:
Move-Item -LiteralPath .daybridge-monitor/state.json -Destination .daybridge-monitor/state.backup.json
node scripts/pr-monitor/monitor.mjs --once
```

State contains normalized PR metadata/hashes, not tokens, raw human comments or authorization headers, and is ignored by Git. It is not a backup of GitHub. Resetting it produces fresh baseline notifications. To pause durable monitoring, the human lead can disable the workflow in Actions; to restart, enable and manually dispatch. The local watcher is optional; no Windows startup task or persistent service is installed.

## Finding and acknowledging work

At each agent's next working turn, inspect PR conversation, review submissions, inline threads and current checks (GitHub UI or these commands; #3 is now merged, substitute the current PR number):

```powershell
gh pr view 3 --repo dude297/c0mpiled-hackathon --comments
gh api repos/dude297/c0mpiled-hackathon/pulls/3/reviews --paginate
gh api repos/dude297/c0mpiled-hackathon/pulls/3/comments --paginate
gh pr checks 3 --repo dude297/c0mpiled-hackathon
```

The conversation command alone does not cover every inline thread. Find unresolved threads in Files changed. Respond manually with `[DAYBRIDGE][ACK] <finding/topic> @ <head SHA> — <role>: <decision, next action, proof link>`. Do not interpret a bot status as an agent instruction or approval. Owners link the resolving commit/tests; reviewer/Opus resolves the thread after checking evidence. Work independently audits closure. The monitor never parses ACK text as permission to execute or merge.

## Release gates

Required CI and a clean PR are necessary but insufficient. Opus/GLM must prove consent, current dependency confirmations, cancellation/reapproval, duplicate/out-of-order behavior and confirmed learning. A must demonstrate the integrated UI and accessible status/approval controls. Lead must approve persistence/auth boundaries for any hosted multi-user use, actual local AI/fallback claims, secrets, privacy and rollback. B must provide source evidence and truthful external vs simulated labels. Preserve `vercel.json` auto-deployment restrictions. No live invite/booking/spend, public deployment or release without human lead authority.

## Validation and reference

See [MONITOR_VALIDATION.md](MONITOR_VALIDATION.md) for exact executed results and remaining activation checks. Implementation follows GitHub's [event support](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [trusted PR-target execution guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target), and [conditional request/rate-limit guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api). No event webhook or branch-protection setting has been changed by this work.
