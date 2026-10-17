import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { GitHub, ApiError, backoff, retryDelay } from './github.mjs';
import { changesSince, MARKER, ownersFor, previousSnapshot, safe, statusComment, summarize, targetsForEvent } from './core.mjs';
import { acquireLock, config, loadState, localCycle, remember, runEvent, runWatcher, saveState, settings } from './monitor.mjs';

const conn = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false } });
function fixture() {
  return {
    number: 3, state: 'OPEN', isDraft: false, headRefOid: 'abc', baseRefOid: 'base', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', author: { login: 'author' },
    files: conn([{ path: 'src/lib/schema.ts' }, { path: 'src/domain/coordination/coordinator.ts' }]), labels: conn([]),
    reviews: conn([{ state: 'APPROVED', authorAssociation: 'COLLABORATOR', submittedAt: '2026-10-17T00:00:00Z', commit: { oid: 'abc' }, author: { login: 'reviewer' } }]),
    comments: conn([]), reviewThreads: conn([]),
    commits: conn([{ commit: { statusCheckRollup: { contexts: conn(config.requiredChecks.map((name, i) => ({ __typename: 'CheckRun', name, databaseId: i, status: 'COMPLETED', conclusion: 'SUCCESS' }))) } } }]),
  };
}
const snapshot = () => summarize(fixture(), config);
const emptyState = () => ({ version: 1, prs: {}, seen: {} });

test('sample GitHub events route only to associated PRs and suppress bot/self loops', async () => {
  const samples = JSON.parse(await readFile(new URL('./fixtures/events.json', import.meta.url), 'utf8'));
  const pulls = [{ number: 3, head: { sha: 'abc', ref: 'feat/coordination-engine', repo: { full_name: config.repository } } }];
  for (const sample of samples) assert.deepEqual(targetsForEvent(sample.name, sample.payload, pulls), sample.targets, sample.name);
  assert.deepEqual(targetsForEvent('issue_comment', { issue: { number: 3, pull_request: {} }, comment: { body: MARKER, user: { login: 'human' } } }, pulls), []);
  assert.deepEqual(targetsForEvent('push', { ref: 'refs/heads/feat/coordination-engine', repository: { full_name: 'fork/repo' } }, pulls), []);
});

test('readiness requires exact checks, current-head independent review and clean merge', () => {
  assert.equal(snapshot().ready, true);
  const mutations = [
    (p) => { p.headRefOid = 'new'; }, (p) => { p.reviews.nodes[0].author.login = 'author'; },
    (p) => { p.reviews.nodes[0].state = 'CHANGES_REQUESTED'; }, (p) => { p.isDraft = true; },
    (p) => { p.reviews.nodes[0].authorAssociation = 'NONE'; },
    (p) => { p.reviews.nodes[0].author.login = 'reviewer[bot]'; },
    (p) => { p.mergeable = 'UNKNOWN'; }, (p) => { p.mergeStateStatus = 'BEHIND'; },
    (p) => { p.commits.nodes[0].commit.statusCheckRollup.contexts.nodes.pop(); },
    (p) => { p.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].conclusion = 'SKIPPED'; },
    (p) => { p.reviewThreads.nodes.push({ isResolved: false, comments: conn([]) }); },
    (p) => { p.labels.nodes.push({ name: 'blocked' }); }, (p) => { p.files.pageInfo.hasNextPage = true; },
    (p) => { p.reviews.pageInfo.hasPreviousPage = true; }, (p) => { p.state = 'CLOSED'; },
  ];
  for (const mutate of mutations) { const p = fixture(); mutate(p); assert.equal(summarize(p, config).ready, false, mutate.toString()); }
});

test('latest decisive review supersedes prior review; comment review does not erase changes requested', () => {
  const p = fixture(); p.reviews.nodes.push({ ...p.reviews.nodes[0], state: 'CHANGES_REQUESTED' }, { ...p.reviews.nodes[0], state: 'COMMENTED' });
  assert.deepEqual(summarize(p, config).changes, ['reviewer']);
  p.reviews.nodes.push({ ...p.reviews.nodes[0], state: 'DISMISSED' });
  assert.deepEqual(summarize(p, config).changes, []);
  assert.equal(summarize(p, config).ready, false);
  p.reviews.nodes.push({ ...p.reviews.nodes[0], state: 'CHANGES_REQUESTED', author: { login: 'reviewer[bot]' } });
  assert(summarize(p, config).changes.includes('reviewer[bot]'));
});

test('detects commits/contracts, failures, retries, conflicts, approvals, cleared blockers and readiness', () => {
  const old = snapshot(); const p = fixture();
  p.headRefOid = 'def'; p.mergeable = 'CONFLICTING'; p.mergeStateStatus = 'DIRTY';
  p.reviews.nodes[0].state = 'CHANGES_REQUESTED'; p.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].conclusion = 'FAILURE';
  const next = summarize(p, config); const notes = changesSince(old, next).join(' ');
  for (const word of ['new commits', 'contract', 'changes requested', 'CI failed', 'merge conflict', 'revoked']) assert.match(notes, new RegExp(word));
  const retry = structuredClone(p); retry.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[0].databaseId = 99;
  assert.match(changesSince(next, summarize(retry, config)).join(), /CI failed/);
  next.blockers = ['blocked']; next.unresolved = 1;
  const resolved = changesSince(next, old).join();
  for (const word of ['approval', 'cleared', 'resolved', 'label removed', 'READY FOR INTEGRATION']) assert.match(resolved, new RegExp(word));
});

test('inline and issue comments produce actionable notifications without echoing content', () => {
  const p = fixture(); const old = summarize(p, config);
  p.comments.nodes.push({ databaseId: 1, updatedAt: 'later', body: 'SECRET @everyone', author: { login: 'reviewer' } });
  p.reviewThreads.nodes.push({ isResolved: false, comments: conn([{ databaseId: 2, updatedAt: 'later', author: { login: 'reviewer' } }]) });
  const next = summarize(p, config);
  assert.match(changesSince(old, next).join(), /discussion updated/); assert.match(changesSince(old, next).join(), /inline review/);
  assert(!JSON.stringify(next).includes('SECRET'));
  assert(!statusComment(next, ['CI @someone <script>']).includes('@someone'));
});

test('status comment state roundtrip and spoofed author protection', () => {
  const next = snapshot(); const body = statusComment(next, ['new PR']);
  const good = { databaseId: 4, author: { login: 'github-actions[bot]' }, body };
  assert.deepEqual(previousSnapshot([good], 3).snapshot, next);
  assert.equal(previousSnapshot([{ ...good, author: { login: 'attacker' } }], 3).snapshot, undefined);
  assert.equal(previousSnapshot([good], 99).snapshot, undefined);
  assert.equal(previousSnapshot([{ ...good, body: MARKER + '<!-- daybridge-state:invalid -->' }], 3).snapshot, undefined);
});

test('workflow reconciles once, edits one existing comment, then writes nothing on duplicate or bot event', async () => {
  const pr = fixture(); const writes = [];
  const api = { pull: async () => pr, request: async (url, options) => {
    writes.push([url, options.method]); pr.comments.nodes = [{ databaseId: 77, author: { login: 'github-actions[bot]' }, body: options.body.body }];
  }, listPulls: async () => { throw new Error('direct event must not list PRs'); } };
  const event = { pull_request: { number: 3 } };
  await runEvent(api, 'pull_request_target', event, { log: () => {} });
  await runEvent(api, 'pull_request_target', event, { log: () => {} }); assert.equal(writes.length, 1);
  pr.headRefOid = 'new'; await runEvent(api, 'pull_request_target', event, { log: () => {} });
  assert.deepEqual(writes.at(-1), [`/repos/${config.repository}/issues/comments/77`, 'PATCH']);
  await runEvent(api, 'issue_comment', { issue: { number: 3, pull_request: {} }, comment: { user: { type: 'Bot' }, body: MARKER } });
  assert.equal(writes.length, 2);
});

test('ETag conditional requests reuse 304, fixed origin/no redirects, no auth leakage', async () => {
  const calls = [];
  const api = new GitHub('fake-test-secret', { paceMs: 0, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return calls.length === 1 ? new Response('[1]', { headers: { etag: '"v1"' } }) : new Response(null, { status: 304 });
  } });
  assert.deepEqual((await api.request('/test')).data, [1]);
  assert.equal((await api.request('/test')).unchanged, true);
  assert.equal(calls[1][1].headers['if-none-match'], '"v1"'); assert.equal(calls[0][1].redirect, 'error');
  await assert.rejects(api.request('//evil.test/'), /Invalid/);
  assert(!JSON.stringify(snapshot()).includes('fake-test-secret'));
  assert(!JSON.stringify(api).includes('fake-test-secret'));
});

test('review signal handles merge SHA association and deduplicates signal-run retries', async () => {
  const pr = fixture(); let writes = 0;
  const api = { listPulls: async () => [{ number: 3, head: { sha: 'abc' } }], pull: async () => pr, request: async (_url, options) => {
    writes++; pr.comments.nodes = [{ databaseId: 77, author: { login: 'github-actions[bot]' }, body: options.body.body }];
  } };
  const event = { workflow_run: { id: 15, run_attempt: 1, name: 'DayBridge review signal', head_sha: 'merge-sha', pull_requests: [{ number: 3 }] } };
  await runEvent(api, 'workflow_run', event, { log: () => {} });
  await runEvent(api, 'workflow_run', event, { log: () => {} }); assert.equal(writes, 1);
  event.workflow_run.id++;
  await runEvent(api, 'workflow_run', event, { log: () => {} }); assert.equal(writes, 2);
});

test('watcher aborts a backoff delay and records recoverable API failure without printing response bodies', async () => {
  const controller = new AbortController(); const logs = [];
  await runWatcher({ api: { listPulls: async () => { throw new ApiError(503); } }, state: emptyState(), repo: 'o/r', interval: 8000, signal: controller.signal,
    log: (s) => { logs.push(s); if (s.includes('delayed')) controller.abort(); } });
  assert(logs.some((s) => s.includes('HTTP 503'))); assert.match(logs.at(-1), /stopped/);
});

test('rate limit handling honors Retry-After/reset and exponential backoff', async () => {
  assert.equal(retryDelay(new Headers({ 'retry-after': '17' })), 17000);
  assert.equal(retryDelay(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '200' }), 100000), 101000);
  assert.equal(retryDelay(new Headers({ 'retry-after': new Date(120000).toUTCString() }), 100000), 20000);
  assert(backoff(4, () => 0) > backoff(1, () => 0)); assert.equal(backoff(99, () => 0), 300000);
  for (const status of [403, 429]) {
    const api = new GitHub('fake', { paceMs: 0, fetchImpl: async () => new Response('{}', { status, headers: { 'retry-after': '3' } }) });
    await assert.rejects(api.request('/test'), (e) => e instanceof ApiError && e.retryMs === 3000);
    await assert.rejects(api.request('/test'), (e) => e.status === 429);
  }
});

test('PR pagination and GraphQL errors fail closed', async () => {
  const api = new GitHub('fake', { paceMs: 0, fetchImpl: async (url) => url.endsWith('/graphql')
    ? new Response('{"errors":[{"message":"sensitive"}]}')
    : new Response(url.includes('page=2') ? '[{"number":2}]' : '[{"number":1}]', { headers: url.includes('page=2') ? {} : { link: '<next>; rel="next"' } }) });
  assert.deepEqual(await api.listPulls('o/r'), [{ number: 1 }, { number: 2 }]);
  await assert.rejects(api.pull('o/r', 1), /readiness withheld/);
});

test('8s polling is configurable; credentials are never required for help', () => {
  assert.equal(settings({}).interval, 8000); assert.equal(settings({ DAYBRIDGE_POLL_MS: '12000' }).interval, 12000);
  assert.throws(() => settings({ DAYBRIDGE_POLL_MS: '10' }), /8000/);
  assert.throws(() => settings({ DAYBRIDGE_REPOSITORY: '../../bad' }), /Invalid/);
  assert.throws(() => new GitHub(''), /Authentication required/);
  assert(safe('@owner\n<code>').includes('＠owner'));
  assert.deepEqual(ownersFor(['src/app/page.tsx', 'src/domain/activities.ts', 'src/simulation/foo.ts'], config), ['GLM', 'Teammate A', 'Teammate B']);
});

test('local refresh cadence and persisted dedup avoid API/comment floods', async () => {
  const state = emptyState(); let reads = 0; const logs = [];
  const api = { listPulls: async () => [{ number: 3, head: { sha: 'abc' }, updated_at: 'now' }], pull: async () => { reads++; return fixture(); } };
  await localCycle(api, state, 'o/r', { now: 100000, log: (s) => logs.push(s) });
  await localCycle(api, state, 'o/r', { now: 108000, log: (s) => logs.push(s) }); assert.equal(reads, 1);
  await localCycle(api, state, 'o/r', { now: 161000, log: (s) => logs.push(s) }); assert.equal(reads, 2); assert.equal(logs.length, 1);
  assert.equal(remember(state, snapshot(), changesSince(undefined, snapshot())), false);
});

test('state persistence, clean lock release, live duplicate and stale-lock recovery', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'daybridge-monitor-')); const file = path.join(dir, 'state.json'); const lock = file + '.lock';
  try {
    const state = await loadState(file); remember(state, snapshot(), ['first']); await saveState(file, state);
    assert.deepEqual(await loadState(file), state);
    const release = await acquireLock(lock);
    await assert.rejects(acquireLock(lock), /already owns/); await release();
    await writeFile(lock, '999999'); const release2 = await acquireLock(lock, process.pid, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); }); await release2();
    await writeFile(file, 'bad json'); await assert.rejects(loadState(file), /state invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('watcher starts, runs once, persists and stops; auth failure terminates', async () => {
  const logs = []; let saved = 0;
  await runWatcher({ api: { listPulls: async () => [] }, state: emptyState(), repo: 'o/r', interval: 8000, once: true, log: (s) => logs.push(s), persist: async () => { saved++; } });
  assert.match(logs[0], /started/); assert.match(logs.at(-1), /stopped/); assert(saved >= 1);
  await assert.rejects(runWatcher({ api: { listPulls: async () => { throw new ApiError(401); } }, state: emptyState(), repo: 'o/r', interval: 8000, log: () => {} }), /authentication/);
});

test('abort interrupts sleep promptly and persists state', async () => {
  const controller = new AbortController(); let saved = 0;
  await runWatcher({ api: { listPulls: async () => [] }, state: emptyState(), repo: 'o/r', interval: 8000, signal: controller.signal, persist: async () => { saved++; controller.abort(); }, log: () => {} });
  assert(saved >= 1);
});

test('process-level watcher receives SIGTERM and exits cleanly', async () => {
  // Child runs the real loop with a stubbed API; no credentials, network or workflow writes.
  const code = `import {runWatcher} from './scripts/pr-monitor/monitor.mjs';const c=new AbortController();process.once('SIGTERM',()=>c.abort());await runWatcher({api:{listPulls:async()=>[]},state:{version:1,prs:{},seen:{}},repo:'o/r',interval:8000,signal:c.signal});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; child.stdout.on('data', (b) => { output += b; if (output.includes('started')) child.stdin?.end(); });
  await once(child.stdout, 'data');
  // Windows terminates rather than delivering POSIX SIGTERM. Abort test above verifies portable cleanup.
  child.kill('SIGTERM'); const [codeValue, signal] = await once(child, 'exit');
  if (process.platform !== 'win32') { assert.equal(codeValue, 0); assert.match(output, /stopped/); } else assert(codeValue !== null || signal);
});

test('workflow security boundaries and required CI names remain intact', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/pr-monitor.yml', import.meta.url), 'utf8');
  const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const reviewSignal = await readFile(new URL('../../.github/workflows/pr-review-signal.yml', import.meta.url), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert(!workflow.includes('pull_request.head')); assert(!workflow.includes('pull_request_review_thread:'));
  assert(!workflow.includes('secrets.')); assert(!ci.includes('secrets.'));
  assert(!reviewSignal.includes('uses:')); assert.match(reviewSignal, /permissions: \{\}/);
  assert(!workflow.includes('  pull_request_review:')); assert(!workflow.includes('  pull_request_review_comment:'));
  assert.match(workflow, /cancel-in-progress: false/); assert.match(ci, /contents: read/);
  for (const check of config.requiredChecks) assert(ci.includes(`  ${check}:`));
});
