import { setTimeout as delay } from 'node:timers/promises';

export class ApiError extends Error {
  constructor(status, retryMs = 0) { super(`GitHub request failed (HTTP ${status}); credentials and response body withheld`); this.status = status; this.retryMs = retryMs; }
}
export function retryDelay(headers, now = Date.now()) {
  const after = headers.get('retry-after');
  if (after) return Math.max(1000, /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - now || 60000);
  if (headers.get('x-ratelimit-remaining') === '0') return Math.max(1000, Number(headers.get('x-ratelimit-reset')) * 1000 - now + 1000 || 60000);
  return 60000;
}
export const backoff = (attempt, random = Math.random) => Math.min(300000, 8000 * 2 ** Math.min(attempt, 6)) + Math.floor(random() * 1000);

export class GitHub {
  #token;
  constructor(token, { fetchImpl = fetch, signal, paceMs = 100 } = {}) {
    if (!token?.trim()) throw new Error('Authentication required: GH_TOKEN, GITHUB_TOKEN or gh auth login. No token is printed.');
    this.#token = token.trim(); this.fetch = fetchImpl; this.signal = signal; this.paceMs = paceMs;
    this.cache = new Map(); this.notBefore = 0;
  }
  async request(path, { method = 'GET', body } = {}) {
    // Fixed origin and no redirects: a config/event cannot send credentials to another host.
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub API path');
    const wait = this.notBefore - Date.now();
    if (wait > 0) throw new ApiError(429, wait);
    await delay(this.paceMs, undefined, { signal: this.signal });
    const cached = method === 'GET' ? this.cache.get(path) : undefined;
    const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${this.#token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'daybridge-pr-monitor', ...(body ? { 'content-type': 'application/json' } : {}), ...(cached?.etag ? { 'if-none-match': cached.etag } : {}) };
    const timeout = AbortSignal.timeout(20000);
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
    const res = await this.fetch(`https://api.github.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal, redirect: 'error' });
    if (res.status === 403 || res.status === 429) {
      const retryMs = retryDelay(res.headers); this.notBefore = Date.now() + retryMs; throw new ApiError(res.status, retryMs);
    }
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null && Number(remaining) < 50) this.notBefore = Date.now() + retryDelay(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': res.headers.get('x-ratelimit-reset') ?? '' }));
    if (res.status === 304 && cached) return { ...cached, unchanged: true };
    if (!res.ok) throw new ApiError(res.status);
    const result = { data: await res.json(), etag: res.headers.get('etag'), link: res.headers.get('link'), unchanged: false };
    if (method === 'GET') this.cache.set(path, result);
    return result;
  }
  async listPulls(repo) {
    const all = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.request(`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100&page=${page}`);
      all.push(...r.data);
      if (!r.link?.includes('rel="next"')) return all;
    }
    throw new Error('PR inventory exceeds 2000 entries; narrow scope before monitoring.');
  }
  async pull(repo, number) {
    const [owner, name] = repo.split('/');
    const result = await this.request('/graphql', { method: 'POST', body: { query: QUERY, variables: { owner, name, number } } });
    if (result.data.errors?.length || !result.data.data?.repository?.pullRequest) throw new Error('GitHub snapshot unavailable (GraphQL error); readiness withheld.');
    const rate = result.data.data.rateLimit;
    if (rate && rate.remaining < 50) this.notBefore = Date.parse(rate.resetAt) + 1000;
    return result.data.data.repository.pullRequest;
  }
}

// Bounded query. Truncated connections explicitly withhold readiness instead of implying full review.
export const QUERY = `query($owner:String!,$name:String!,$number:Int!){
 rateLimit { remaining resetAt cost }
 repository(owner:$owner,name:$name){pullRequest(number:$number){
 number state isDraft headRefOid baseRefOid mergeable mergeStateStatus author{login}
 files(first:100){nodes{path} pageInfo{hasNextPage}}
 labels(first:100){nodes{name} pageInfo{hasNextPage}}
 reviews(last:100){nodes{state submittedAt authorAssociation author{login} commit{oid}} pageInfo{hasPreviousPage}}
 comments(last:100){nodes{databaseId updatedAt body author{login}} pageInfo{hasPreviousPage}}
 reviewThreads(first:50){nodes{id isResolved comments(last:10){nodes{databaseId updatedAt author{login}} pageInfo{hasPreviousPage}}} pageInfo{hasNextPage}}
 commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{
 __typename ... on CheckRun{databaseId name status conclusion completedAt} ... on StatusContext{id context state createdAt}
 } pageInfo{hasNextPage}}}}}
 }}}
}`;
