// Checks lib/onboarding.ts answersToProfile / reviewRows (PR #12 lead review: never infer transport,
// mobility, hearing or group size). No test runner needed:
//   node scripts/check-onboarding.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(import.meta.url)('typescript');
const libPath = join(here, '../lib/onboarding.ts');
const src = readFileSync(libPath, 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const dir = mkdtempSync(join(tmpdir(), 'onboarding-'));
const file = join(dir, 'onboarding.mjs');
writeFileSync(file, out.outputText);
const { answersToProfile, reviewRows, toggleComfort, CARDS, COMFORT_OPTIONS, MOBILITY_OPTIONS, TRANSPORT_OPTIONS } = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

let n = 0;
const check = (label, fn) => {
  fn();
  n++;
  console.log(`  ok  ${label}`);
};

// 1. Lead's repro: the old stairs answers must not yield any profile, let alone one that drives.
check("lead repro: [{mobility:'fine'}] 'QA no car' is incomplete, never drive", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'fine' }], 'QA no car');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['mobility', 'transport', 'comfort']);
  assert.ok(!JSON.stringify(r).includes('drive'));
});
check("lead repro: [{mobility:'avoid'}] is incomplete, no invented walker/transport", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'avoid' }], 'QA');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['mobility', 'transport', 'comfort']);
  assert.ok(!/walker|paratransit|family|bus/.test(JSON.stringify(r)));
});

// 2. Missing either required answer → incomplete, nothing invented.
const NEITHER = { kind: 'comfort', keys: ['neither'] };
check('no answers → missing mobility + transport + comfort', () => {
  assert.deepEqual(answersToProfile([], 'A'), { ok: false, missing: ['mobility', 'transport', 'comfort'] });
});
check('mobility only → missing transport (no transport inferred from mobility)', () => {
  for (const m of MOBILITY_OPTIONS)
    assert.deepEqual(answersToProfile([{ kind: 'mobility', key: m.key }, NEITHER], 'A'), { ok: false, missing: ['transport'] });
});
check('transport only → missing mobility (no mobility inferred from transport)', () => {
  assert.deepEqual(answersToProfile([{ kind: 'transport', keys: ['drive'] }, NEITHER], 'A'), { ok: false, missing: ['mobility'] });
});
check('empty / bogus transport list → missing transport', () => {
  assert.deepEqual(answersToProfile([{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: [] }, NEITHER], 'A'), { ok: false, missing: ['transport'] });
  assert.deepEqual(answersToProfile([{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: ['teleport'] }, NEITHER], 'A'), { ok: false, missing: ['transport'] });
});

// 2b. Lead review (P2): hearing + group size are asked, never defaulted to false.
check("lead probe: mobility + transport but no 'Anything else that helps?' answer → ok:false, missing 'comfort', no false invented", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: ['drive'] }], 'QA');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['comfort']);
  assert.ok(!('profile' in r));
  assert.ok(!/hearingImpaired|prefersSmallGroups/.test(JSON.stringify(r)));
});
check('empty / bogus / contradictory comfort answer → missing comfort', () => {
  const base = [{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: ['drive'] }];
  for (const keys of [[], ['loud'], ['neither', 'hearing'], ['smallGroups', 'neither']])
    assert.deepEqual(answersToProfile([...base, { kind: 'comfort', keys }], 'A'), { ok: false, missing: ['comfort'] }, JSON.stringify(keys));
});
check("'Neither of these' → hearingImpaired false + prefersSmallGroups false, explicitly", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: ['drive'] }, NEITHER], 'A');
  assert.equal(r.ok, true);
  assert.equal(r.profile.hearingImpaired, false);
  assert.equal(r.profile.prefersSmallGroups, false);
  assert.ok(!r.defaulted.includes('comfort'));
});
check('each comfort option maps 1:1', () => {
  const base = [{ kind: 'mobility', key: 'cane' }, { kind: 'transport', keys: ['bus'] }];
  const get = (keys) => {
    const r = answersToProfile([...base, { kind: 'comfort', keys }], 'A');
    assert.equal(r.ok, true);
    return [r.profile.hearingImpaired, r.profile.prefersSmallGroups];
  };
  assert.deepEqual(get(['hearing']), [true, false]);
  assert.deepEqual(get(['smallGroups']), [false, true]);
  assert.deepEqual(get(['hearing', 'smallGroups']), [true, true]);
  assert.deepEqual(get(['smallGroups', 'hearing']), [true, true]);
  assert.deepEqual(get(['neither']), [false, false]);
});
check('comfort card wording + Neither is exclusive', () => {
  assert.deepEqual(COMFORT_OPTIONS.map((o) => [o.key, o.label]), [
    ['hearing', 'Noisy rooms are hard for me to hear in'], ['smallGroups', 'I prefer small groups'], ['neither', 'Neither of these'],
  ]);
  assert.deepEqual(toggleComfort([], 'hearing'), ['hearing']);
  assert.deepEqual(toggleComfort(['hearing'], 'smallGroups'), ['hearing', 'smallGroups']);
  assert.deepEqual(toggleComfort(['hearing', 'smallGroups'], 'neither'), ['neither']);
  assert.deepEqual(toggleComfort(['neither'], 'smallGroups'), ['smallGroups']);
  assert.deepEqual(toggleComfort(['neither'], 'neither'), []);
  assert.deepEqual(toggleComfort(['hearing'], 'hearing'), []);
  const screen = readFileSync(join(here, '../app/onboarding.tsx'), 'utf8');
  assert.match(screen, /title="Anything else that helps\?"/);
  assert.match(screen, /helper="Pick any that apply\."/);
  assert.match(screen, /'transport', 'comfort', 'budget', 'review'/);
  assert.ok(!/hearingImpaired: false|prefersSmallGroups: false/.test(src), 'lib still hard-codes false');
});

// 3. Explicit answers map 1:1, exactly.
check("walker + bus-only → mobility 'walker', transport ['bus'] exactly", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'walker' }, { kind: 'transport', keys: ['bus'] }, NEITHER], 'Pat');
  assert.equal(r.ok, true);
  assert.equal(r.profile.mobility, 'walker');
  assert.deepEqual(r.profile.transport, ['bus']);
});
check('every mobility × every transport subset maps exactly (no stairs/mobility → transport path)', () => {
  const keys = TRANSPORT_OPTIONS.map((o) => o.key);
  for (const m of MOBILITY_OPTIONS)
    for (let mask = 1; mask < 1 << keys.length; mask++) {
      const chosen = keys.filter((_, i) => mask & (1 << i));
      const r = answersToProfile([{ kind: 'transport', keys: chosen }, { kind: 'mobility', key: m.key }, NEITHER], 'A');
      assert.equal(r.ok, true);
      assert.equal(r.profile.mobility, m.key);
      assert.deepEqual(r.profile.transport, chosen);
    }
});
check('card wording + 1:1 keys', () => {
  assert.deepEqual(MOBILITY_OPTIONS.map((o) => [o.key, o.label]), [
    ['full', 'No, I walk on my own'], ['cane', 'A cane'], ['walker', 'A walker'], ['wheelchair', 'A wheelchair'],
  ]);
  assert.deepEqual(TRANSPORT_OPTIONS.map((o) => [o.key, o.label]), [
    ['drive', 'I drive myself'], ['bus', 'Bus or train'], ['paratransit', 'Senior shuttle (paratransit)'],
    ['family', 'Family or friends drive me'], ['walk', 'I walk there'],
  ]);
  const t = CARDS.map((c) => c.type);
  assert.deepEqual(t.slice(-6), ['times', 'travel', 'mobility', 'transport', 'comfort', 'budget']);
});
check('no stairs code path remains in the lib or screen', () => {
  const screen = readFileSync(join(here, '../app/onboarding.tsx'), 'utf8');
  const details = readFileSync(join(here, '../app/(tabs)/details.tsx'), 'utf8');
  for (const [name, text] of [['lib/onboarding.ts', src], ['app/onboarding.tsx', screen], ['app/(tabs)/details.tsx', details]]) {
    assert.ok(!/stair/i.test(text), `${name} still mentions stairs`);
    assert.ok(!/'fine'|'hassle'|'avoid'/.test(text), `${name} still has stairs keys`);
  }
  assert.ok(!/mobilityValue|=== 'full' \?/.test(src), 'transport derived from mobility');
});
check('Back during a Change keeps returning to the review (back() never clears editing)', () => {
  const screen = readFileSync(join(here, '../app/onboarding.tsx'), 'utf8');
  const body = screen.match(/const back = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(body, 'back() not found');
  assert.ok(!/setEditing\(false\)/.test(body[1]), 'back() clears editing');
  assert.ok(!/Same questions, order and mapping as web CardDeck/.test(screen), 'stale web-parity header');
});

// 4. Defaults are explicit and shown as "(default)" on the review.
const minimal = [{ kind: 'mobility', key: 'cane' }, { kind: 'transport', keys: ['family', 'paratransit'] }, { kind: 'comfort', keys: ['smallGroups'] }];
check('defaults listed: interests, times, travel, budget', () => {
  const r = answersToProfile(minimal, '');
  assert.equal(r.ok, true);
  assert.deepEqual(r.defaulted, ['interests', 'times', 'travel', 'budget']);
  assert.equal(r.profile.name, 'Friend');
  assert.deepEqual(r.profile.transport, ['paratransit', 'family']); // option order, same set
});
check('review lists every answer; defaults labeled "(default)"; walking aid, transport, hearing, group size never default', () => {
  const rows = reviewRows(minimal);
  assert.deepEqual(rows.map((r) => r.id), ['interests', 'times', 'travel', 'mobility', 'transport', 'hearing', 'groups', 'budget']);
  assert.deepEqual(rows.map((r) => r.field), ['interests', 'times', 'travel', 'mobility', 'transport', 'comfort', 'comfort', 'budget']);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const f of ['interests', 'times', 'travel', 'budget']) {
    assert.equal(by[f].isDefault, true, f);
    assert.match(by[f].text, /\(default\)$/, f);
  }
  assert.equal(by.interests.text, 'Learning new things (default)');
  assert.equal(by.mobility.text, 'A cane');
  assert.equal(by.transport.text, 'Senior shuttle (paratransit), Family or friends drive me');
  assert.ok(!by.mobility.isDefault && !by.transport.isDefault);
  assert.equal(by.hearing.title, 'Hearing');
  assert.equal(by.hearing.text, 'No trouble hearing');
  assert.equal(by.groups.title, 'Group size');
  assert.equal(by.groups.text, 'Prefers small groups');
  assert.ok(!by.hearing.isDefault && !by.groups.isDefault);
});
check('review Hearing / Group size rows for every comfort answer; unanswered says so (never a false default)', () => {
  const two = (keys) => {
    const rows = reviewRows([{ kind: 'mobility', key: 'cane' }, ...(keys ? [{ kind: 'comfort', keys }] : [])]);
    return rows.filter((r) => r.field === 'comfort').map((r) => [r.title, r.text]);
  };
  assert.deepEqual(two(['neither']), [['Hearing', 'No trouble hearing'], ['Group size', 'Any size is fine']]);
  assert.deepEqual(two(['hearing']), [['Hearing', 'Noisy rooms are hard to hear in'], ['Group size', 'Any size is fine']]);
  assert.deepEqual(two(['smallGroups', 'hearing']), [['Hearing', 'Noisy rooms are hard to hear in'], ['Group size', 'Prefers small groups']]);
  assert.deepEqual(two(null), [['Hearing', 'Not answered yet'], ['Group size', 'Not answered yet']]);
});
check('chosen values are not labeled default', () => {
  const rows = reviewRows([
    ...minimal,
    { kind: 'interest', key: 'music', liked: true },
    { kind: 'interest', key: 'cards', liked: false },
    { kind: 'times', keys: ['evening'] },
    { kind: 'travel', min: 15 },
    { kind: 'budget', amount: 0 },
  ]);
  assert.ok(rows.every((r) => !r.isDefault && !r.text.includes('(default)')));
  assert.deepEqual(rows.map((r) => r.text), [
    'Music & singing', 'Evenings', 'A short drive (about 15 minutes)', 'A cane',
    'Senior shuttle (paratransit), Family or friends drive me', 'No trouble hearing', 'Prefers small groups', 'Free only ($0 a week)',
  ]);
});
check('Change one answer → only that review row changes (others preserved)', () => {
  const base = [...minimal, { kind: 'times', keys: ['morning'] }, { kind: 'travel', min: 45 }, { kind: 'budget', amount: 25 }];
  const changed = base.map((a) => (a.kind === 'mobility' ? { kind: 'mobility', key: 'wheelchair' } : a));
  const a = reviewRows(base), b = reviewRows(changed);
  for (let i = 0; i < a.length; i++)
    if (a[i].field === 'mobility') assert.equal(b[i].text, 'A wheelchair');
    else assert.deepEqual(b[i], a[i]);
  const p = answersToProfile(changed, 'A');
  assert.equal(p.profile.mobility, 'wheelchair');
  assert.deepEqual(p.profile.transport, ['paratransit', 'family']);
  assert.equal(p.profile.prefersSmallGroups, true);
});
check('Change "Anything else that helps?" → only Hearing / Group size rows change (others preserved)', () => {
  const base = [...minimal, { kind: 'times', keys: ['morning'] }, { kind: 'travel', min: 45 }, { kind: 'budget', amount: 25 }];
  const changed = base.map((a) => (a.kind === 'comfort' ? { kind: 'comfort', keys: ['hearing'] } : a));
  const a = reviewRows(base), b = reviewRows(changed);
  for (let i = 0; i < a.length; i++)
    if (a[i].field === 'comfort') assert.notDeepEqual(b[i], a[i]);
    else assert.deepEqual(b[i], a[i]);
  const p = answersToProfile(changed, 'A');
  assert.deepEqual([p.profile.hearingImpaired, p.profile.prefersSmallGroups], [true, false]);
  assert.equal(p.profile.mobility, 'cane');
  assert.deepEqual(p.profile.transport, ['paratransit', 'family']);
  assert.equal(p.profile.budgetPerWeek, 25);
  const review = readFileSync(join(here, '../components/onboarding/ReviewStep.tsx'), 'utf8');
  assert.match(review, /key=\{r\.id\}/, 'review rows keyed by unique id');
});

console.log(`onboarding: all checks passed (${n})`);
