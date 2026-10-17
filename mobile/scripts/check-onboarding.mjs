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
const onboarding = await import(pathToFileURL(file).href);
const { answersToProfile, reviewRows, toggleComfort, prefillDemo, canStartIntake, INTEREST_META, CARDS, COMFORT_OPTIONS, MOBILITY_OPTIONS, TRANSPORT_OPTIONS } = onboarding;
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

// Run the actual screen/component callbacks with small native and hook adapters. No server, device,
// camera, network or extra test dependencies: this catches selection accidentally navigating again.
function evaluateTs(relative, modules = {}, clock = Date) {
  const source = readFileSync(join(here, relative), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'Date', outputText)((id) => {
    assert.ok(id in modules, `Unexpected runtime dependency: ${id}`);
    return modules[id];
  }, module, module.exports, clock);
  return module.exports;
}
const { DEMO_PROFILES } = evaluateTs('../../src/domain/activities.ts');
const theme = evaluateTs('../lib/theme.ts');
const native = Object.fromEntries(['KeyboardAvoidingView', 'Text', 'View', 'ScrollView', 'Pressable', 'TextInput'].map((name) => [name, name]));
Object.assign(native, { Platform: { OS: 'ios' }, StyleSheet: { create: (styles) => styles } });
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });

function harness(relative = '../app/onboarding.tsx', exportName = 'default', initialProps = {}) {
  const slots = [];
  let index = 0, dirty = false, now = 1000, tree;
  let effects = [];
  const calls = [], routes = [];
  let complete;
  const store = {
    profile: null, firstName: null, loading: false,
    analyze: (profile, name) => {
      calls.push({ profile, name });
      return new Promise((resolve) => { complete = resolve; });
    },
  };
  const hooks = {
    useState: (initial) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (value) => {
        const next = typeof value === 'function' ? value(slots[slot]) : value;
        if (!Object.is(slots[slot], next)) dirty = true;
        slots[slot] = next;
      }];
    },
    useRef: (initial) => {
      const slot = index++;
      return slots[slot] ?? (slots[slot] = { current: initial });
    },
    useEffect: (effect, deps) => {
      const slot = index++;
      if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot][i]))) {
        effects.push(effect);
        slots[slot] = deps;
      }
    },
  };
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useRouter: () => ({ push: (route) => routes.push(route) }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@expo/vector-icons/Ionicons': { default: 'Ionicons' },
    '@/lib/onboarding': onboarding, '@/lib/theme': theme, '@/lib/store': { useApp: () => store },
    '@/domain/activities': { DEMO_PROFILES },
    './ui': { PillButton: 'PillButton', s: {}, useHeadingFocus: () => null },
    '@/components/onboarding/ui': { PillButton: 'PillButton' },
  };
  for (const name of ['NameStep', 'ChoiceStep', 'InterestGrid', 'ReviewStep', 'SwipeDeck', 'HandsFree']) {
    const exported = name === 'HandsFree' ? 'HandsFreeDeck' : name;
    modules[`@/components/onboarding/${name}`] = { [exported]: exported };
  }
  const Component = evaluateTs(relative, modules, { now: () => now })[exportName];
  const render = () => {
    let passes = 0;
    do {
      assert.ok(++passes < 10, 'render/effect loop');
      index = 0; dirty = false; effects = [];
      tree = Component(initialProps);
      effects.forEach((effect) => effect());
    } while (dirty);
    return tree;
  };
  const nodes = () => {
    const found = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      found.push(node);
      visit(node.props?.children);
    };
    visit(tree);
    return found;
  };
  const get = (type) => {
    const node = nodes().find((node) => node.type === type);
    assert.ok(node, `${type} not rendered`);
    return node.props;
  };
  render();
  return {
    get, nodes, render, calls, routes, store,
    resolve: () => complete(),
    act: (fn, ...args) => { now += 500; const result = fn(...args); render(); return result; },
  };
}

check('Start requires a chosen person + a chosen mode, including a nonblank self name', () => {
  for (const mode of [null, 'swipe', 'easy', 'hands']) {
    assert.equal(canStartIntake(null, '', mode), false);
    assert.equal(canStartIntake(null, 'Pat', mode), false);
    assert.equal(canStartIntake('self', '   ', mode), false);
    assert.equal(canStartIntake('self', ' Pat ', mode), mode !== null);
    assert.equal(canStartIntake('margaret', 'Margaret', mode), mode !== null);
  }
  const h = harness();
  h.act(h.get('NameStep').onStart);
  assert.equal(h.get('NameStep').person, null);
  assert.equal(h.get('NameStep').mode, null);
});

check('Margaret selection fills later answers; swipe/hands interests remain for the cards', () => {
  const p = DEMO_PROFILES.margaret;
  for (const mode of [null, 'swipe', 'hands', 'easy']) {
    const draft = prefillDemo(p, mode);
    assert.equal(draft.name, 'Margaret');
    assert.deepEqual(draft.times, p.times);
    assert.equal(draft.travel, p.maxTravelMin);
    assert.equal(draft.mobility, p.mobility);
    assert.deepEqual(draft.transport, p.transport);
    assert.deepEqual(draft.comfort, ['hearing', 'smallGroups']);
    assert.equal(draft.budget, p.budgetPerWeek);
    if (mode === 'easy') {
      for (const interest of INTEREST_META) assert.equal(draft.liked[interest.key], p.interests.includes(interest.key));
    } else assert.deepEqual(draft.liked, {});
  }
});

check('every mode stays on person selection; selecting Margaret never analyzes; Start runs the chosen cards', () => {
  for (const mode of ['swipe', 'easy', 'hands']) {
    const h = harness();
    h.act(h.get('NameStep').onMode, mode);
    h.act(h.get('NameStep').onStart);
    assert.equal(h.get('NameStep').person, null, 'mode alone must not start');
    h.act(h.get('NameStep').onPerson, 'margaret');
    assert.equal(h.get('NameStep').name, 'Margaret');
    assert.equal(h.get('NameStep').mode, mode);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.routes, []);
    const start = h.get('NameStep').onStart;
    h.act(() => { start(); start(); });
    const deck = h.get(mode === 'easy' ? 'InterestGrid' : mode === 'hands' ? 'HandsFreeDeck' : 'SwipeDeck');
    assert.deepEqual(deck.sampleInterests, DEMO_PROFILES.margaret.interests);
    if (mode === 'easy') assert.deepEqual([...deck.picked], DEMO_PROFILES.margaret.interests);
    else assert.equal(deck.cursor, 0);
  }
});

function startSample(mode) {
  const h = harness();
  h.act(h.get('NameStep').onPerson, 'margaret');
  h.act(h.get('NameStep').onMode, mode);
  h.act(h.get('NameStep').onStart);
  return h;
}

function continueSample(h) {
  const expected = [['morning', 'afternoon'], ['30'], ['walker'], ['bus', 'family'], ['hearing', 'smallGroups'], ['10']];
  for (const selected of expected) {
    assert.deepEqual(h.get('ChoiceStep').selected, selected, 'sample selection must be visible');
    const next = h.get('ChoiceStep').onContinue;
    h.act(() => { next(); next(); });
  }
  const review = h.get('ReviewStep');
  assert.ok(review.rows.every((row) => !row.isDefault && !row.text.includes('Not answered yet')));
  return review;
}

check('swipe + hands-free answers come from cards, then six visible prefills → review; Back and Change work', () => {
  for (const mode of ['swipe', 'hands']) {
    const h = startSample(mode);
    const deck = mode === 'hands' ? 'HandsFreeDeck' : 'SwipeDeck';
    h.act(h.get(deck).onAnswer, 'music', true);
    h.act(h.get(deck).onBack);
    assert.equal(h.get(deck).cursor, 0);
    for (const i of INTEREST_META) h.act(h.get(deck).onAnswer, i.key, i.key === 'cooking');
    h.act(h.nodes().find((node) => node.type === 'PillButton' && node.props.label === 'Back').props.onPress);
    assert.equal(h.get(deck).cursor, INTEREST_META.length - 1);
    h.act(h.get(deck).onAnswer, INTEREST_META.at(-1).key, false);
    const review = continueSample(h);
    assert.equal(review.rows.find((r) => r.field === 'interests').value, 'Cooking', 'must not silently restore sample interests');
    h.act(review.onChange, 'mobility');
    h.act(h.get('ChoiceStep').onToggle, 'cane');
    h.act(h.nodes().find((node) => node.type === 'PillButton' && node.props.label === 'Back').props.onPress);
    assert.equal(h.get('ChoiceStep').title, 'How far is too far?');
    h.act(h.get('ChoiceStep').onContinue);
    assert.equal(h.get('ReviewStep').rows.find((r) => r.field === 'mobility').value, 'A cane');
  }
});

check('Easier view sample interests are editable and mode changes preserve edits', () => {
  const h = startSample('easy');
  h.act(h.get('InterestGrid').onToggle, 'music');
  h.act(h.get('InterestGrid').onToggle, 'cooking');
  const back = () => h.nodes().find((node) => node.type === 'PillButton' && node.props.label === 'Back').props.onPress;
  h.act(back());
  h.act(h.get('NameStep').onMode, 'hands');
  h.act(h.get('NameStep').onMode, 'easy');
  h.act(h.get('NameStep').onStart);
  assert.deepEqual([...h.get('InterestGrid').picked], ['gardening', 'cards', 'cooking']);
  h.act(h.get('InterestGrid').onContinue);
  const review = continueSample(h);
  assert.equal(review.rows.find((r) => r.field === 'interests').value, 'Gardening, Cards & games, Cooking');
});

check('switching from Margaret to myself clears sample answers and still requires a name', () => {
  const h = harness();
  h.act(h.get('NameStep').onPerson, 'margaret');
  h.act(h.get('NameStep').onMode, 'easy');
  h.act(h.get('NameStep').onPerson, 'self');
  assert.equal(h.get('NameStep').name, '');
  h.act(h.get('NameStep').onStart);
  h.act(h.get('NameStep').onName, 'Pat');
  h.act(h.get('NameStep').onStart);
  assert.equal(h.get('InterestGrid').picked.size, 0);
  h.act(h.get('InterestGrid').onContinue);
  assert.deepEqual(h.get('ChoiceStep').selected, []);
});

check('first screen person radios precede modes; Start gating + Margaret-only shortcut; Harold data stays hidden', () => {
  const screen = harness();
  const renderName = () => harness('../components/onboarding/NameStep.tsx', 'NameStep', { ...screen.get('NameStep'), bottomInset: 0 });
  let h = renderName();
  assert.equal(h.nodes().find((node) => node.type === 'PillButton').props.disabled, true);
  assert.equal(h.nodes().some((node) => node.props.accessibilityRole === 'link'), false);
  screen.act(screen.get('NameStep').onPerson, 'margaret');
  h = renderName();
  const radios = h.nodes().filter((node) => node.props.accessibilityRole === 'radio');
  assert.deepEqual(radios.slice(0, 2).map((node) => node.props.accessibilityLabel), ['Margaret (sample person)', 'Answer as myself']);
  assert.equal(radios[0].props['aria-checked'], true);
  assert.equal(radios[1].props['aria-checked'], false);
  assert.ok(radios.slice(2).every((node) => node.props['aria-checked'] === false));
  assert.equal(h.nodes().find((node) => node.props.accessibilityRole === 'link').props.accessibilityLabel, "Skip to Margaret's results");
  assert.equal(h.nodes().find((node) => node.type === 'PillButton').props.disabled, true);
  screen.act(screen.get('NameStep').onMode, 'hands');
  assert.equal(renderName().nodes().find((node) => node.type === 'PillButton').props.disabled, false);
  assert.equal(DEMO_PROFILES.harold.name, 'Harold');
  for (const name of ['NameStep', 'SwipeDeck', 'InterestGrid', 'HandsFree']) {
    const source = readFileSync(join(here, `../components/onboarding/${name}.tsx`), 'utf8');
    assert.doesNotMatch(source, /harold/i);
  }
  const hands = readFileSync(join(here, '../components/onboarding/HandsFree.tsx'), 'utf8');
  assert.match(hands, /Turn on camera/);
  assert.match(hands, /sampleInterests=\{sampleInterests\}/);
  for (const name of ['SwipeDeck', 'InterestGrid']) {
    assert.match(readFileSync(join(here, `../components/onboarding/${name}.tsx`), 'utf8'), /Margaret would say:.*sampleInterests.includes/);
  }
});

// The shortcut always uses the original sample profile, even after edits; only confirmation submits
// the edited intake. Keep the promise pending to prove duplicate taps cannot analyze twice.
for (const shortcut of [true, false]) {
  const h = shortcut ? harness() : startSample('easy');
  if (shortcut) {
    h.act(h.get('NameStep').onSkipDemo);
    assert.equal(h.calls.length, 0, 'shortcut must reject an unselected sample');
    h.act(h.get('NameStep').onPerson, 'margaret');
  } else {
    h.act(h.get('InterestGrid').onToggle, 'music');
    h.act(h.get('InterestGrid').onContinue);
    continueSample(h);
  }
  const submit = shortcut ? h.get('NameStep').onSkipDemo : h.get('ReviewStep').onConfirm;
  const first = submit(), second = submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'Margaret');
  if (shortcut) assert.strictEqual(h.calls[0].profile, DEMO_PROFILES.margaret);
  else assert.deepEqual(h.calls[0].profile, { ...DEMO_PROFILES.margaret, interests: ['gardening', 'cards'] });
  assert.deepEqual(h.routes, []);
  h.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(h.routes, ['/(tabs)/matches']);
  n++;
  console.log(`  ok  ${shortcut ? 'Margaret-only shortcut uses original profile' : 'review confirmation uses edited prefills'}; double-tap submits once`);
}

console.log(`onboarding: all checks passed (${n})`);
