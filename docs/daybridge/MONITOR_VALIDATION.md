# PR monitor validation evidence

2026-10-17, Windows / Node `v24.15.0`, npm `11.16.0`. Initial baseline `26b976233f53d3dede16a92416258e8a3c464cdb`; operations branch refreshed onto merged main `c76fa70d7380b356aad5a2aca170619215cafea1`. Only monitoring scripts, three Actions workflows, operations/audit docs and the local-state ignore rule differ from that approved main. No business logic, package/lockfile, Next config, hosting settings or deployment guard changed by Work. PR #1/#3 were merged by another actor during this task.

## Executed locally

| Check | Result and scope |
|---|---|
| `node --test scripts/pr-monitor/monitor.node-test.mjs` | **19/19 passed**, 0 failed/skipped. Sample/stubbed events and HTTP responses only; no real provider calls or new credentials. |
| Workflow YAML parsing | `ci.yml`, `pr-monitor.yml`, `pr-review-signal.yml` parsed successfully using the already-installed `js-yaml`; no new dependency. Static tests also assert default-branch checkout, no head checkout, no secret references, no-permission review signal and matching required check names. This is not a hosted Actions run or actionlint certification. |
| Node syntax/help | `node --check` passed on monitor modules; `node scripts/pr-monitor/monitor.mjs --help` succeeds without authentication. Query delimiters balanced; live GraphQL schema/request validation remains unverified. |
| Repository checks | **PASS**, exit 0: route type generation/typecheck and lint completed without reported errors; 2 files / 12 baseline tests passed (Vitest 9.72s). The separate monitoring suite contains the 19 Node tests above, intentionally outside Vitest discovery. |
| Production build | **PASS**, exit 0 after normal locked install and normal network/process access: compiled in 22.2s, TypeScript completed, 5/5 static pages generated; `/` static and `/api/analyze` dynamic. Warning: parent lockfile outside this repository was ignored. No deploy. This baseline/operations tree does not include unmerged #3 business code. |
| PR #3 independent check | Isolated unchanged `b35a4fb` snapshot: `npm run check` passed, 4 files / 39 tests, typecheck/lint passed. Author's build/smoke claims were not independently adopted. |
| PR #7 against merged core | Unchanged Phase 2 test file from `106b0f7`, injected into isolated `c76fa70` snapshot: **1 file / 18 tests passed**, 4.44s. No network, provider calls are simulated. |
| Refreshed main + operations check/build | **PASS**, exit 0, sequential `npm run check` then `npm run build` on `c76fa70` + operations files. Typecheck/lint passed; **5 files / 140 tests passed**, Vitest 4.04s. Build compiled in 7.2s, TypeScript passed, 6/6 static pages; analyze and all four coordination endpoints dynamic. Parent-lockfile warning only. No deploy. Monitoring Node tests independently **19/19 passed** again on this refreshed tree. |
| Consent scope probe | At `b35a4fb`, confirmed invite carried between different activities in same slot. At merged `c76fa70`, independent probe **passes closure**: old invite superseded; new activity-scoped invitation requires approval. No real invitation or Work source fix. See [refresh](INTEGRATION_QA_REFRESH.md). |
| Diff checks | Whitespace checked; no application/business-logic, dependency or hosting diff. |

Test coverage includes routing sample PR/review/inline/issue/push/CI/check/status events; bot-loop suppression; exact-head checks and trusted independent approval; unknown/behind/conflicting merge state; cleared labels/reviews/threads; contract/commit changes; sticky-comment roundtrip and spoofed author rejection; duplicate events with zero second write; existing comment PATCH instead of new POST; no-permission review signal replay; ETag/304; pagination; GraphQL error fail-closed behavior; 403/429/reset/Retry-After; exponential backoff; aborted retry/sleep; fixed API origin and disabled redirects; token exclusion from serialized client/state; polling cadence; atomic state save; duplicate/stale PID locks; corrupt-state recovery; start/once/stop; process-level termination.

The initial sandboxed state-file test hit EPERM on renaming its own temp file. The same suite passed with normal filesystem permission. Process-level SIGTERM on Windows is a forced termination, so that test asserts termination rather than claiming POSIX signal cleanup; the portable AbortController test independently verifies persistence/clean loop shutdown. Ctrl+C is handled by the actual watcher. No Windows startup service/task was installed.

An early build using a dependency junction failed because Turbopack disallows resolving Next from outside the checkout. Only the junction itself was removed; its dependency target was retained. A normal `npm ci --ignore-scripts --no-audit --no-fund` then succeeded (`added 623 packages in 2m`). The final build result above refers to the normal install; no application code was changed to accommodate the environment.

## Not yet verified / activation acceptance

- Local GitHub CLI authentication is invalid on this machine (`gh auth status` reports invalid token). Connected GitHub reads/writes work, but they do not expose a token to the Node process. No live authenticated watcher query is claimed. Local user setup is documented in [PR_OPERATIONS.md](PR_OPERATIONS.md); no credential or permission escalation is needed to run fixture tests.
- Default-branch hosted activation requires human lead merge of the reviewed installation. This work does not merge or deploy. Before activation the trusted monitor deliberately reports pending installation. No always-on ChatGPT computer or chat-to-agent delivery is configured or assumed.
- After merge, lead/Opus manually dispatch **DayBridge PR monitor**, verify one status comment, repeat dispatch (zero duplicate write), submit a test review/inline comment, and confirm one update with correct owner/action. Verify Actions run summary and no bot feedback loop. Hosted permissions, subscriptions and current-head GraphQL snapshot must be checked then.
- Required check names are documented/configured in code, but repository branch-protection/ruleset enforcement has not been changed. CI completion on GitHub and the integrated application release candidate remain separate evidence.
- GitHub schedules may be delayed. Review-thread resolution is reconciled periodically rather than through an unsupported Actions event. Bot comment edits do not guarantee email/push notification; agent acknowledgment is manual and explicit.

Independent monitoring readiness is not DayBridge product release readiness. PR #3 remains mock-only, unauthenticated and nonpersistent; UI and independent integration tests remain necessary. No merges, deployments, real messages or bookings were performed.
