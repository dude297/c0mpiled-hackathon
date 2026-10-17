import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { GitHub, ApiError, backoff } from './github.mjs';
import { changesSince, digest, notification, previousSnapshot, safe, statusComment, summarize, targetsForEvent } from './core.mjs';

const exec = promisify(execFile);
export const config = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8'));
export function settings(env) {
  const repo = env.DAYBRIDGE_REPOSITORY || config.repository;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid DAYBRIDGE_REPOSITORY; expected owner/repo.');
  const interval = Number(env.DAYBRIDGE_POLL_MS ?? 8000);
  if (!Number.isFinite(interval) || interval < 8000) throw new Error('DAYBRIDGE_POLL_MS must be at least 8000.');
  return { repo, interval, statePath: path.resolve(env.DAYBRIDGE_STATE_FILE || '.daybridge-monitor/state.json') };
}
export async function authentication(env = process.env) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return env.GH_TOKEN || env.GITHUB_TOKEN;
  try { return (await exec('gh', ['auth', 'token', '--hostname', 'github.com'], { windowsHide: true })).stdout.trim(); }
  catch { throw new Error('GitHub authentication unavailable. Use gh auth login or set GH_TOKEN in this session; no token was printed.'); }
}
export async function loadState(file) {
  try {
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (state.version !== 1 || !state.prs || !state.seen) throw new Error();
    return state;
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error('Watcher state invalid. Stop watcher, move state file aside, restart to reconcile.');
    return { version: 1, prs: {}, seen: {} };
  }
}
export async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  // This stores hashes/PR state only: never token, raw comment bodies or response headers.
  await writeFile(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
export async function acquireLock(file, pid = process.pid, alive = (id) => { process.kill(id, 0); }) {
  await mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await open(file, 'wx', 0o600); await handle.writeFile(String(pid)); await handle.close(); return async () => { if ((await readFile(file, 'utf8').catch(() => '')) === String(pid)) await unlink(file); }; }
    catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const existing = Number(await readFile(file, 'utf8'));
      if (!Number.isSafeInteger(existing) || existing <= 0) throw new Error('Invalid watcher lock. Verify no watcher runs before removing it.');
      try { alive(existing); } catch (e) { if (e.code === 'ESRCH') { await unlink(file); continue; } }
      throw new Error('A watcher already owns this state file. Stop it before starting another.');
    }
  }
  throw new Error('Watcher lock could not be acquired.');
}

export function remember(state, snapshot, notes) {
  const key = digest({ number: snapshot.number, head: snapshot.head, notes, snapshot });
  const fresh = notes.length && !state.seen[key];
  if (notes.length) state.seen[key] = Date.now();
  const keys = Object.keys(state.seen);
  for (const k of keys.slice(0, Math.max(0, keys.length - 2000))) delete state.seen[k];
  state.prs[snapshot.number] = snapshot;
  return Boolean(fresh);
}

export async function localCycle(api, state, repo, { now = Date.now(), log = console.log } = {}) {
  const pulls = await api.listPulls(repo);
  // One aggregate GraphQL query per PR when listing changes, otherwise at most once/minute.
  // Scale refresh for very large teams; REST inventory still uses conditional 8s polling.
  const refresh = Math.max(60000, pulls.length * 2000);
  const listed = new Set(pulls.map((p) => p.number));
  const candidates = pulls.map((p) => ({ number: p.number, listing: digest([p.head.sha, p.updated_at, p.draft]) }));
  for (const [number, old] of Object.entries(state.prs)) if (old.state === 'OPEN' && !listed.has(Number(number))) candidates.push({ number: Number(number), listing: 'closed' });
  for (const p of candidates) {
    const old = state.prs[p.number];
    if (old?.listing === p.listing && now - (old.fetchedAt ?? 0) < refresh) continue;
    const next = summarize(await api.pull(repo, p.number), config);
    const notes = changesSince(old, next);
    if (remember(state, next, notes)) log(notification(next, notes));
    state.prs[p.number] = { ...next, listing: p.listing, fetchedAt: now };
  }
}

export async function runWatcher({ api, state, repo, interval, once = false, signal, persist = async () => {}, log = console.log }) {
  let failures = 0;
  log(`DayBridge watcher started: ${repo}; inventory ${interval}ms; read-only, console notifications.`);
  try {
    do {
      let wait = interval;
      try { await localCycle(api, state, repo, { log }); await persist(); failures = 0; }
      catch (err) {
        if (signal?.aborted) break;
        if (err.status === 401 || err.status === 404) throw new Error('GitHub authentication/repository access failed. Check account and read permissions; no credentials printed.');
        if (once) throw err;
        wait = Math.max(backoff(failures++), err.retryMs || 0);
        log(`Monitoring delayed ${Math.ceil(wait / 1000)}s (${err instanceof ApiError ? `HTTP ${err.status}` : 'network/API failure'}); retrying without duplicate notifications.`);
      }
      if (once || signal?.aborted) break;
      await delay(wait, undefined, { signal });
    } while (!signal?.aborted);
  } catch (err) { if (!signal?.aborted) throw err; }
  finally { await persist(); log('DayBridge watcher stopped; state saved.'); }
}

export async function runEvent(api, name, event, { repo = config.repository, log = console.log, summary = async () => {} } = {}) {
  // Ignore bot discussion events before any requests. No bot body is ever interpreted as a command.
  if (name === 'issue_comment' && (!event.issue?.pull_request || event.comment?.user?.type === 'Bot' || event.comment?.body?.includes('<!-- daybridge-pr-monitor:'))) return [];
  if (name === 'workflow_run' && !['DayBridge CI', 'DayBridge review signal'].includes(event.workflow_run?.name)) return [];
  const direct = event.pull_request?.number || (name === 'issue_comment' && event.issue?.number);
  const pulls = direct ? [] : await api.listPulls(repo);
  const numbers = [...new Set(targetsForEvent(name, event, pulls))];
  const result = [];
  for (const number of numbers) {
    const pr = await api.pull(repo, number);
    const next = summarize(pr, config);
    const { comment, snapshot } = previousSnapshot(pr.comments?.nodes ?? [], number);
    const notes = changesSince(snapshot, next);
    // Explicit comment events cover edits outside the bounded recent-comment query.
    next.signals = snapshot?.signals ?? [];
    if (name === 'workflow_run' && event.workflow_run?.name === 'DayBridge review signal') {
      const key = digest([event.workflow_run.id, event.workflow_run.run_attempt]);
      if (!next.signals.includes(key)) {
        notes.push('review activity changed — owner reads latest review and inline threads');
        next.signals = [...next.signals, key].slice(-100);
      }
    }
    if (['issue_comment', 'pull_request_review_comment', 'pull_request_review'].includes(name)) {
      const item = event.comment ?? event.review;
      if (item?.id) {
        const key = digest([name, event.action, item.id, item.updated_at ?? item.submitted_at, item.state]);
        if (!next.signals.includes(key)) {
          notes.push(`${name === 'issue_comment' ? 'PR discussion' : 'review'} ${event.action ?? 'updated'} — owner reads and acknowledges on GitHub`);
          next.signals = [...next.signals, key].slice(-100);
        }
      }
    }
    if (!notes.length) continue;
    const message = notification(next, notes); log(message); result.push(message);
    const body = statusComment(next, notes);
    if (comment) await api.request(`/repos/${repo}/issues/comments/${comment.databaseId}`, { method: 'PATCH', body: { body } });
    else await api.request(`/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
  }
  await summary(result.length ? result.join('\n\n') : 'No actionable PR change; no comment written.');
  return result;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.includes('--help')) { console.log('Usage: node scripts/pr-monitor/monitor.mjs [--once|--event|--help]\nDAYBRIDGE_POLL_MS=8000; GH_TOKEN/GITHUB_TOKEN or gh auth login. Local mode is read-only.'); return; }
  if (args.some((a) => !['--once', '--event'].includes(a))) throw new Error('Unknown argument; use --help.');
  const options = settings(env);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  let release;
  try {
    const api = new GitHub(await authentication(env), { signal: controller.signal });
    if (args.includes('--event')) {
      if (env.GITHUB_ACTIONS !== 'true') throw new Error('--event writes PR status; only supported in the trusted GitHub workflow. Local watcher is read-only.');
      const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
      await runEvent(api, env.GITHUB_EVENT_NAME, event, { repo: options.repo, summary: async (s) => { if (env.GITHUB_STEP_SUMMARY) await writeFile(env.GITHUB_STEP_SUMMARY, s); } });
    } else {
      release = await acquireLock(`${options.statePath}.lock`);
      const state = await loadState(options.statePath);
      if (state.repository && state.repository !== options.repo) throw new Error('State belongs to a different repository; use a separate state path.');
      state.repository = options.repo;
      await runWatcher({ api, state, ...options, once: args.includes('--once'), signal: controller.signal, persist: () => saveState(options.statePath, state) });
    }
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); if (release) await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const known = /^(GitHub |Authentication required|Watcher |A watcher |Invalid |DAYBRIDGE_|Unknown argument|--event |PR inventory|State belongs)/.test(err.message);
    console.error(known ? safe(err.message) : 'Monitor stopped with an error. Check authentication, rate limits, repository access and local state; no credentials or API bodies printed.');
    process.exitCode = 1;
  });
}
