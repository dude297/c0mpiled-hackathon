import { createHash } from 'node:crypto';

export const MARKER = '<!-- daybridge-pr-monitor:v1 -->';
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const safe = (value) => String(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/@/g, '＠').replace(/[<>`*_[\]\\]/g, '').slice(0, 240);
const bot = (login = '') => login.endsWith('[bot]');
const nodes = (connection) => connection?.nodes ?? [];

export function ownersFor(files, config) {
  return [...new Set(files.map((file) => config.owners.find((r) => file.startsWith(r.prefix))?.owner ?? 'Opus (integration)'))].sort();
}

export function summarize(pr, config) {
  const files = nodes(pr.files).map((f) => f.path).sort();
  const labels = nodes(pr.labels).map((l) => l.name).sort();
  const reviews = {};
  for (const r of nodes(pr.reviews)) {
    if (!r.author || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) continue;
    reviews[r.author.login] = { state: r.state, head: r.commit?.oid, at: r.submittedAt, trusted: ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(r.authorAssociation) };
  }
  const checks = nodes(nodes(pr.commits)[0]?.commit?.statusCheckRollup?.contexts).map((c) => ({
    name: c.name ?? c.context,
    state: c.__typename === 'StatusContext' ? c.state : (c.status === 'COMPLETED' ? c.conclusion : c.status),
    identity: c.databaseId ?? c.id, at: c.completedAt ?? c.createdAt,
  })).sort((a, b) => a.name.localeCompare(b.name) || String(a.state).localeCompare(String(b.state)));
  const failed = checks.filter((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'].includes(c.state)).map((c) => c.name);
  const missing = config.requiredChecks.filter((name) => !checks.some((c) => c.name === name) || checks.filter((c) => c.name === name).some((c) => c.state !== 'SUCCESS'));
  const changes = Object.entries(reviews).filter(([, r]) => r.state === 'CHANGES_REQUESTED').map(([login]) => login).sort();
  // Self-review is never an independent approval. Old-head approvals do not authorize a new commit.
  const approvals = Object.entries(reviews).filter(([login, r]) => !bot(login) && login !== pr.author?.login && r.trusted && r.state === 'APPROVED' && r.head === pr.headRefOid).map(([login]) => login).sort();
  const threads = nodes(pr.reviewThreads);
  const unresolved = threads.filter((t) => !t.isResolved).length;
  const comments = nodes(pr.comments).filter((c) => c.author && !bot(c.author.login) && !c.body?.includes(MARKER)).map((c) => [c.databaseId, c.updatedAt]);
  const inline = threads.flatMap((t) => nodes(t.comments).filter((c) => c.author).map((c) => [c.databaseId, c.updatedAt, t.isResolved]));
  const incomplete = [pr.files, pr.labels, pr.reviews, pr.comments, pr.reviewThreads, ...threads.map((t) => t.comments), nodes(pr.commits)[0]?.commit?.statusCheckRollup?.contexts].some((c) => c?.pageInfo?.hasNextPage || c?.pageInfo?.hasPreviousPage);
  const blockers = labels.filter((l) => config.blockingLabels.includes(l));
  const reasons = [];
  if (pr.state !== 'OPEN') reasons.push('PR closed');
  if (pr.isDraft) reasons.push('draft');
  if (pr.mergeable !== 'MERGEABLE' || pr.mergeStateStatus !== 'CLEAN') reasons.push(`merge state ${pr.mergeStateStatus ?? 'UNKNOWN'}`);
  if (missing.length) reasons.push(`checks not successful: ${missing.map(safe).join(', ')}`);
  if (failed.length) reasons.push(`failed checks: ${failed.map(safe).join(', ')}`);
  if (changes.length) reasons.push('changes requested');
  if (!approvals.length) reasons.push('needs independent approval on current head');
  if (unresolved) reasons.push(`${unresolved} unresolved review thread(s)`);
  if (blockers.length) reasons.push(`blocking label(s): ${blockers.map(safe).join(', ')}`);
  if (incomplete) reasons.push('API history truncated; manual review required');
  return {
    number: pr.number, head: pr.headRefOid, base: pr.baseRefOid, state: pr.state,
    owners: ownersFor(files, config), mergeable: pr.mergeable, mergeState: pr.mergeStateStatus,
    contracts: files.filter((p) => config.contractPaths.includes(p) || p.startsWith('src/app/api/coordination/')),
    reviews: digest(reviews), changes, approvals, comments: digest(comments), inline: digest(inline),
    unresolved, blockers, failed: [...new Set(failed)], missing, checks: digest(checks),
    ready: reasons.length === 0, reasons,
  };
}

export function changesSince(old, next) {
  const notes = [];
  if (!old) notes.push('new PR observed — review ownership and next steps');
  if (old && old.head !== next.head) notes.push('new commits — re-review current head and rerun checks');
  if (old && old.base !== next.base) notes.push('base changed — verify integrated contracts');
  if (old && old.state !== next.state) notes.push(`PR ${next.state.toLowerCase()} — reconcile dependent branches`);
  if ((!old || old.head !== next.head || digest(old.contracts) !== digest(next.contracts)) && next.contracts.length) notes.push('shared API contract included — Opus coordinates A/B/GLM acknowledgment before integration');
  if ((!old || old.reviews !== next.reviews) && next.changes.length) notes.push('changes requested — resolve reviewer findings before integration');
  if ((!old || old.reviews !== next.reviews) && next.approvals.length) notes.push('current-head approval — Opus checks remaining gates');
  if (old && old.reviews !== next.reviews && old.changes.length && !next.changes.length) notes.push('requested-change review cleared — verify remaining gates');
  if (old && old.comments !== next.comments) notes.push('PR discussion updated — owner reads and acknowledges comment');
  if (old && old.inline !== next.inline) notes.push('inline review updated — owner reads affected thread');
  if (old && old.unresolved > next.unresolved) notes.push('review blocker resolved — Opus verifies evidence');
  if ((!old || old.checks !== next.checks) && next.failed.length) notes.push(`CI failed: ${next.failed.map(safe).join(', ')} — owner investigates logs`);
  if (old?.failed.length && !next.failed.length) notes.push('CI failure cleared — check required jobs still pass');
  if (next.mergeable === 'CONFLICTING' && old?.mergeable !== next.mergeable) notes.push('merge conflict — Opus coordinates file owners; rebase/merge base, then rerun CI');
  if (old?.mergeable === 'CONFLICTING' && next.mergeable === 'MERGEABLE') notes.push('merge conflict cleared — re-review resolution and rerun integration checks');
  if (old && old.blockers.some((l) => !next.blockers.includes(l))) notes.push('blocking label removed — Opus verifies closure evidence');
  if (next.ready && !old?.ready) notes.push('READY FOR INTEGRATION REVIEW — Opus assembles candidate; human lead retains merge/release authority');
  if (old?.ready && !next.ready) notes.push('integration readiness revoked — satisfy remaining gates');
  if (old && !notes.length && digest(old.reasons) !== digest(next.reasons)) notes.push('integration gates updated — Opus checks remaining requirements');
  return notes;
}

export function notification(snapshot, notes) {
  return `PR #${snapshot.number} | owner: ${snapshot.owners.join('; ') || 'Opus'} | ${notes.join(' | ')}`;
}

export function statusComment(snapshot, notes) {
  const state = Buffer.from(JSON.stringify(snapshot)).toString('base64');
  return `${MARKER}\n<!-- daybridge-state:${state} -->\n**DayBridge coordination — PR #${snapshot.number}**\n\nOwner: ${safe(snapshot.owners.join('; ') || 'Opus')}. Integration coordinator: Opus.\n\n${notes.map((n) => `- ${safe(n)}`).join('\n')}\n\n${snapshot.ready ? '**Ready for integration review**, not permission to merge or release.' : '**Not ready for integration review.**\n\n' + snapshot.reasons.map((r) => `- ${safe(r)}`).join('\n')}\n\nHead: \`${snapshot.head}\`. No automatic agent messaging, merges or deployments.\n`;
}

export function previousSnapshot(comments, number) {
  const candidates = comments.filter((c) => c.author?.login === 'github-actions[bot]' && c.body?.startsWith(MARKER));
  const comment = candidates.at(-1);
  let snapshot;
  try {
    const encoded = comment?.body.match(/<!-- daybridge-state:([A-Za-z0-9+/=]+) -->/)?.[1];
    const parsed = JSON.parse(Buffer.from(encoded ?? '', 'base64').toString());
    if (parsed.number === number && Array.isArray(parsed.reasons) && Array.isArray(parsed.contracts)) snapshot = parsed;
  } catch { /* Corrupt/missing state is reconciled from GitHub, never executed. */ }
  return { comment, snapshot };
}

export function targetsForEvent(name, event, pulls) {
  if (name === 'issue_comment' && (!event.issue?.pull_request || bot(event.comment?.user?.login) || event.comment?.body?.includes(MARKER))) return [];
  if (name === 'workflow_run' && !['DayBridge CI', 'DayBridge review signal'].includes(event.workflow_run?.name)) return [];
  if (event.pull_request?.number) return [event.pull_request.number];
  if (name === 'issue_comment') return [event.issue.number];
  if (name === 'workflow_dispatch' || name === 'schedule') return pulls.map((p) => p.number);
  if (name === 'workflow_run' && event.workflow_run.pull_requests?.length) return event.workflow_run.pull_requests.map((p) => p.number).filter((number) => pulls.some((p) => p.number === number));
  if (name === 'push') {
    if (event.ref === `refs/heads/${event.repository?.default_branch ?? 'main'}`) return pulls.map((p) => p.number);
    return pulls.filter((p) => `refs/heads/${p.head.ref}` === event.ref && p.head.repo?.full_name === event.repository?.full_name).map((p) => p.number);
  }
  const sha = event.workflow_run?.head_sha ?? event.check_run?.head_sha ?? event.check_suite?.head_sha ?? event.sha;
  return sha ? pulls.filter((p) => p.head.sha === sha).map((p) => p.number) : [];
}
