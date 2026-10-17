// Checks lib/onboarding.ts answersToProfile / reviewRows (PR #12 lead review: never infer transport or
// mobility). No test runner needed:
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
const { answersToProfile, reviewRows, CARDS, MOBILITY_OPTIONS, TRANSPORT_OPTIONS } = await import(pathToFileURL(file).href);
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
  assert.deepEqual(r.missing, ['mobility', 'transport']);
  assert.ok(!JSON.stringify(r).includes('drive'));
});
check("lead repro: [{mobility:'avoid'}] is incomplete, no invented walker/transport", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'avoid' }], 'QA');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['mobility', 'transport']);
  assert.ok(!/walker|paratransit|family|bus/.test(JSON.stringify(r)));
});

// 2. Missing either required answer → incomplete, nothing invented.
check('no answers → missing mobility + transport', () => {
  assert.deepEqual(answersToProfile([], 'A'), { ok: false, missing: ['mobility', 'transport'] });
});
check('mobility only → missing transport (no transport inferred from mobility)', () => {
  for (const m of MOBILITY_OPTIONS)
    assert.deepEqual(answersToProfile([{ kind: 'mobility', key: m.key }], 'A'), { ok: false, missing: ['transport'] });
});
check('transport only → missing mobility (no mobility inferred from transport)', () => {
  assert.deepEqual(answersToProfile([{ kind: 'transport', keys: ['drive'] }], 'A'), { ok: false, missing: ['mobility'] });
});
check('empty / bogus transport list → missing transport', () => {
  assert.deepEqual(answersToProfile([{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: [] }], 'A'), { ok: false, missing: ['transport'] });
  assert.deepEqual(answersToProfile([{ kind: 'mobility', key: 'full' }, { kind: 'transport', keys: ['teleport'] }], 'A'), { ok: false, missing: ['transport'] });
});

// 3. Explicit answers map 1:1, exactly.
check("walker + bus-only → mobility 'walker', transport ['bus'] exactly", () => {
  const r = answersToProfile([{ kind: 'mobility', key: 'walker' }, { kind: 'transport', keys: ['bus'] }], 'Pat');
  assert.equal(r.ok, true);
  assert.equal(r.profile.mobility, 'walker');
  assert.deepEqual(r.profile.transport, ['bus']);
});
check('every mobility × every transport subset maps exactly (no stairs/mobility → transport path)', () => {
  const keys = TRANSPORT_OPTIONS.map((o) => o.key);
  for (const m of MOBILITY_OPTIONS)
    for (let mask = 1; mask < 1 << keys.length; mask++) {
      const chosen = keys.filter((_, i) => mask & (1 << i));
      const r = answersToProfile([{ kind: 'transport', keys: chosen }, { kind: 'mobility', key: m.key }], 'A');
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
  assert.deepEqual(t.slice(-5), ['times', 'travel', 'mobility', 'transport', 'budget']);
});
check('no stairs code path remains in the lib or screen', () => {
  const screen = readFileSync(join(here, '../app/onboarding.tsx'), 'utf8');
  for (const [name, text] of [['lib/onboarding.ts', src], ['app/onboarding.tsx', screen]]) {
    assert.ok(!/stair/i.test(text), `${name} still mentions stairs`);
    assert.ok(!/'fine'|'hassle'|'avoid'/.test(text), `${name} still has stairs keys`);
  }
  assert.ok(!/mobilityValue|=== 'full' \?/.test(src), 'transport derived from mobility');
});

// 4. Defaults are explicit and shown as "(default)" on the review.
const minimal = [{ kind: 'mobility', key: 'cane' }, { kind: 'transport', keys: ['family', 'paratransit'] }];
check('defaults listed: interests, times, travel, budget', () => {
  const r = answersToProfile(minimal, '');
  assert.equal(r.ok, true);
  assert.deepEqual(r.defaulted, ['interests', 'times', 'travel', 'budget']);
  assert.equal(r.profile.name, 'Friend');
  assert.deepEqual(r.profile.transport, ['paratransit', 'family']); // option order, same set
});
check('review lists every answer; defaults labeled "(default)"; walking aid + transport never default', () => {
  const rows = reviewRows(minimal);
  assert.deepEqual(rows.map((r) => r.field), ['interests', 'times', 'travel', 'mobility', 'transport', 'budget']);
  const by = Object.fromEntries(rows.map((r) => [r.field, r]));
  for (const f of ['interests', 'times', 'travel', 'budget']) {
    assert.equal(by[f].isDefault, true, f);
    assert.match(by[f].text, /\(default\)$/, f);
  }
  assert.equal(by.interests.text, 'Learning new things (default)');
  assert.equal(by.mobility.text, 'A cane');
  assert.equal(by.transport.text, 'Senior shuttle (paratransit), Family or friends drive me');
  assert.ok(!by.mobility.isDefault && !by.transport.isDefault);
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
    'Senior shuttle (paratransit), Family or friends drive me', 'Free only ($0 a week)',
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
});

console.log(`onboarding: all checks passed (${n})`);
