// Checks lib/handsfree.ts (pure dwell/classify logic) and proves its plain-JS twin
// HANDSFREE_CORE_JS (what the WebView runs) behaves identically. No test runner needed:
//   node scripts/check-handsfree.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ts = createRequire(import.meta.url)('typescript');
const src = readFileSync(join(here, '../lib/handsfree.ts'), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const dir = mkdtempSync(join(tmpdir(), 'handsfree-'));
const file = join(dir, 'handsfree.mjs');
writeFileSync(file, out.outputText);
const tsImpl = await import(pathToFileURL(file).href);
const pageSource = readFileSync(join(here, '../lib/handsfreePage.ts'), 'utf8');
const pageOut = ts.transpileModule(pageSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const pageFile = join(dir, 'handsfreePage.mjs');
writeFileSync(pageFile, pageOut.outputText.replace("from './handsfree'", "from './handsfree.mjs'"));
const { buildHandsFreeHtml, handsFreeModeScript, handsFreeContextScript, isCurrentPageMessage, parsePageMessage } = await import(pathToFileURL(pageFile).href);
rmSync(dir, { recursive: true, force: true });

const names = ['TUNING', 'GAZE_SIGN', 'YAW_SIGN', 'TILT_SIGN', 'gazeFromBlendshapes', 'yawFromLandmarks', 'lookFromSignals', 'tiltFromLandmarks', 'classify', 'initialDwell', 'rearmDwell', 'stepDwell'];
const jsImpl = new Function(`${tsImpl.HANDSFREE_CORE_JS}; return { ${names.join(', ')} };`)();

let n = 0;
const same = (label, a, b) => {
  assert.deepEqual(a, b, `TS and injected JS differ: ${label}`);
  n++;
};

same('TUNING', jsImpl.TUNING, tsImpl.TUNING);
same('GAZE_SIGN', jsImpl.GAZE_SIGN, tsImpl.GAZE_SIGN);
same('TILT_SIGN', jsImpl.TILT_SIGN, tsImpl.TILT_SIGN);
same('YAW_SIGN', jsImpl.YAW_SIGN, tsImpl.YAW_SIGN);

for (const impl of [tsImpl, jsImpl]) {
  const { gazeFromBlendshapes, yawFromLandmarks, lookFromSignals, tiltFromLandmarks, classify, initialDwell, rearmDwell, stepDwell, TUNING } = impl;

  // Gaze: looking to the person's right (= screen right, ❤️) is positive; clamped to [-1, 1].
  assert.ok(gazeFromBlendshapes({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.6 }) > 0.5);
  assert.ok(gazeFromBlendshapes({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }) < -0.5);
  assert.equal(gazeFromBlendshapes({}), 0);
  assert.equal(gazeFromBlendshapes({ eyeLookInLeft: 9, eyeLookOutRight: 9 }), 1);

  // Tilt fixtures follow the reported iPhone roll direction. The old mapping gave No for
  // this positive eye-line angle; the persisted override covers differing device orientation.
  assert.ok(Math.abs(tiltFromLandmarks({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 })) < 1e-9);
  assert.ok(tiltFromLandmarks({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.6 }) > 15);
  assert.ok(tiltFromLandmarks({ x: 0.3, y: 0.6 }, { x: 0.7, y: 0.4 }) < -15);

  // Aspect ratio: a real 15° roll in a 480x640 portrait frame (pixels) must read as 15°, not ~11.5°
  // (and in a 640x480 landscape frame, not ~19.7°).
  const rollFrame = (deg, w, h) => {
    const r = (deg * Math.PI) / 180, cx = w / 2, cy = h / 2, half = 60; // eye corners 120 px apart
    return [{ x: (cx - half * Math.cos(r)) / w, y: (cy - half * Math.sin(r)) / h }, { x: (cx + half * Math.cos(r)) / w, y: (cy + half * Math.sin(r)) / h }];
  };
  for (const [w, h] of [[480, 640], [640, 480], [720, 1280]]) {
    const [a, b] = rollFrame(15, w, h);
    assert.ok(Math.abs(tiltFromLandmarks(a, b, w / h) - 15) < 1e-6, `15° roll reads 15° at ${w}x${h}`);
    assert.ok(Math.abs(tiltFromLandmarks(a, b) - 15) > 2, `uncorrected ${w}x${h} is off (proves the fix matters)`);
  }
  assert.equal(classify(tiltFromLandmarks(...rollFrame(14, 480, 640), 480 / 640), 'center', TUNING.tilt.threshold, TUNING.tilt.hysteresis), 'center');
  assert.equal(classify(tiltFromLandmarks(...rollFrame(16, 480, 640), 480 / 640), 'center', TUNING.tilt.threshold, TUNING.tilt.hysteresis), 'right');

  // Yaw: turning toward screen right moves the nose LEFT in the raw camera image.
  const eyes = [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }];
  assert.ok(Math.abs(yawFromLandmarks({ x: 0.5, y: 0.6 }, ...eyes)) < 1e-9);
  assert.ok(Math.abs(yawFromLandmarks({ x: 0.46, y: 0.6 }, ...eyes) - 0.1) < 1e-9);
  assert.ok(Math.abs(yawFromLandmarks({ x: 0.54, y: 0.6 }, ...eyes) + 0.1) < 1e-9);
  assert.equal(yawFromLandmarks({ x: -9, y: 0.6 }, ...eyes), 1);
  assert.equal(yawFromLandmarks({ x: 9, y: 0.6 }, ...eyes), -1);
  assert.equal(yawFromLandmarks({ x: 0.4, y: 0.6 }, eyes[0], eyes[0]), 0);
  // Same pixel geometry, including a non-horizontal eye line, in portrait and landscape.
  for (const [w, h] of [[480, 640], [640, 480], [720, 1280]]) {
    const a = { x: (w / 2 - 60) / w, y: (h / 2 + 20) / h };
    const b = { x: (w / 2 + 60) / w, y: (h / 2 - 20) / h };
    const nose = { x: (w / 2 - 16) / w, y: (h / 2 + 40) / h };
    assert.ok(Math.abs(yawFromLandmarks(nose, a, b, w / h) - 16 / Math.hypot(120, 40)) < 1e-9);
  }
  // Translating/scaling the face doesn't change normalized yaw.
  assert.ok(Math.abs(yawFromLandmarks({ x: 0.68, y: 0.6 }, { x: 0.6, y: 0.5 }, { x: 0.8, y: 0.5 }) - 0.1) < 1e-9);

  // New Look tuning; Tilt and the return-to-center gate retain their original settings.
  const L = TUNING.look;
  assert.equal(L.threshold, 0.14);
  assert.equal(L.hysteresis, 0.04);
  assert.equal(L.dwellMs, 1200);
  assert.equal(L.yawWeight, 1.5);
  assert.deepEqual(TUNING.tilt, { dwellMs: 800, threshold: 15, hysteresis: 3 });
  assert.equal(TUNING.rearmMs, 400);
  assert.equal(TUNING.calibrateMs, 2000);
  const zoneOf = (v, prev = 'center') => classify(v, prev, L.threshold, L.hysteresis);
  assert.equal(zoneOf(0), 'center');
  assert.equal(zoneOf(0.15), 'right');
  assert.equal(zoneOf(-0.15), 'left');
  assert.equal(zoneOf(0.14), 'center'); // not enough to enter
  assert.equal(zoneOf(-0.14), 'center');
  assert.equal(zoneOf(0.12, 'right'), 'right'); // enough to stay
  assert.equal(zoneOf(-0.12, 'left'), 'left');
  assert.equal(zoneOf(0.09, 'right'), 'center');
  assert.equal(zoneOf(-0.09, 'left'), 'center');
  assert.equal(zoneOf(-0.15, 'right'), 'left');
  assert.equal(classify(20, 'center', 15, 3), 'right');

  // Eyes alone, head alone, or two small movements can select either screen side.
  for (const direction of [-1, 1]) {
    const wanted = direction === 1 ? 'right' : 'left';
    assert.equal(zoneOf(lookFromSignals(direction * 0.15, 0)), wanted);
    assert.equal(zoneOf(lookFromSignals(0, direction * 0.1)), wanted);
    assert.equal(zoneOf(lookFromSignals(direction * 0.06, direction * 0.06)), wanted);
  }
  assert.equal(zoneOf(lookFromSignals(0.06, 0)), 'center');
  assert.equal(zoneOf(lookFromSignals(0, 0.06)), 'center');
  const baseline = { gaze: 0.2, yaw: -0.1 };
  assert.equal(lookFromSignals(baseline.gaze, baseline.yaw, baseline), 0);
  assert.equal(zoneOf(lookFromSignals(0.26, -0.04, baseline)), 'right');
  assert.equal(zoneOf(lookFromSignals(0.14, -0.16, baseline)), 'left');
  assert.ok(Math.abs(lookFromSignals(0.15, -0.1)) < 1e-9, 'opposing gaze and yaw cancel');

  // Dwell machine, driven at 10 ms ticks.
  const run = (zones, dwellMs, rearmMs = TUNING.rearmMs) => {
    let s = initialDwell();
    const log = [];
    let t = 0;
    for (const [zone, ms] of zones) {
      for (let i = 0; i < ms; i += 10) {
        const r = stepDwell(s, zone, (t += 10), dwellMs, rearmMs);
        s = r.state;
        log.push(r);
      }
    }
    return log;
  };
  const fires = (log) => log.filter((r) => r.fired).map((r) => r.fired);

  // Holds right for the full dwell → exactly one answer, progress climbs to it.
  let log = run([['center', 200], ['right', 1600]], L.dwellMs);
  assert.deepEqual(fires(log), ['right']);
  const mid = log.find((r) => r.side === 'right' && r.progress > 0.45 && r.progress < 0.55);
  assert.ok(mid, 'progress passes 0.5 on the way');

  // Look fires at 1.2 seconds, never before, and needs the center before another answer.
  let exact = stepDwell(initialDwell(), 'right', 0, L.dwellMs, TUNING.rearmMs);
  for (let t = 100; t <= 1100; t += 100) exact = stepDwell(exact.state, 'right', t, L.dwellMs, TUNING.rearmMs);
  exact = stepDwell(exact.state, 'right', 1199, L.dwellMs, TUNING.rearmMs);
  assert.equal(exact.fired, null);
  assert.ok(exact.progress > 0.99);
  exact = stepDwell(exact.state, 'right', 1200, L.dwellMs, TUNING.rearmMs);
  assert.equal(exact.fired, 'right');
  assert.equal(exact.state.needsCenter, true);

  // Holding after firing never repeats.
  log = run([['right', 5000]], L.dwellMs);
  assert.deepEqual(fires(log), ['right']);

  // A short glance back to the middle (< 400 ms) doesn't re-arm.
  log = run([['right', 1600], ['center', 300], ['right', 2000]], L.dwellMs);
  assert.deepEqual(fires(log), ['right']);

  // Back to the middle for ≥ 400 ms re-arms → second answer.
  log = run([['right', 1600], ['center', 500], ['left', 1600]], L.dwellMs);
  assert.deepEqual(fires(log), ['right', 'left']);

  // Switching sides restarts the hold; too short on each side → nothing.
  log = run([['left', 1000], ['right', 1000], ['left', 1000]], L.dwellMs);
  assert.deepEqual(fires(log), []);

  // Losing the face resets progress.
  log = run([['right', 1000], [null, 100], ['right', 1000]], L.dwellMs);
  assert.deepEqual(fires(log), []);
  assert.ok(log.at(-1).state.needsCenter, 'face loss requires a fresh center hold');

  // After a Look/Tilt switch (rearmDwell): a side already held can't fire until the middle is held 400 ms.
  const runFrom = (s, zones, dwellMs) => {
    const log = [];
    let t = 0;
    for (const [zone, ms] of zones)
      for (let i = 0; i < ms; i += 10) {
        const r = stepDwell(s, zone, (t += 10), dwellMs, TUNING.rearmMs);
        s = r.state;
        log.push(r);
      }
    return log;
  };
  assert.deepEqual(fires(runFrom(rearmDwell(), [['right', 3000]], 800)), []);
  assert.deepEqual(fires(runFrom(rearmDwell(), [['right', 1000], ['center', 300], ['right', 1000]], 800)), []);
  assert.deepEqual(fires(runFrom(rearmDwell(), [['right', 1000], ['center', 450], ['right', 900]], 800)), ['right']);

  // Tilt dwell is shorter.
  log = run([['left', 850]], TUNING.tilt.dwellMs);
  assert.deepEqual(fires(log), ['left']);
  n++;
}

// Same frame-by-frame output from both implementations on a mixed script.
const script = [['center', 100], ['right', 700], [null, 50], ['right', 1600], ['center', 200], ['left', 300], ['center', 450], ['left', 1600]];
const trace = (impl) => {
  let s = impl.initialDwell();
  const outp = [];
  let t = 1000;
  for (const [zone, ms] of script)
    for (let i = 0; i < ms; i += 16) {
      const r = impl.stepDwell(s, zone, (t += 16), impl.TUNING.look.dwellMs, impl.TUNING.rearmMs);
      s = r.state;
      outp.push(r);
    }
  return outp;
};
same('stepDwell trace', trace(jsImpl), trace(tsImpl));
for (const v of [-1.2, -0.15, -0.14, -0.12, -0.09, 0, 0.09, 0.12, 0.14, 0.15, 1.2])
  for (const p of ['left', 'center', 'right']) same(`classify ${v} ${p}`, jsImpl.classify(v, p, tsImpl.TUNING.look.threshold, tsImpl.TUNING.look.hysteresis), tsImpl.classify(v, p, tsImpl.TUNING.look.threshold, tsImpl.TUNING.look.hysteresis));
const bs = { eyeLookInLeft: 0.3, eyeLookOutRight: 0.1, eyeLookOutLeft: 0.05, eyeLookInRight: 0.2 };
same('gaze', jsImpl.gazeFromBlendshapes(bs), tsImpl.gazeFromBlendshapes(bs));
same('tilt', jsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }), tsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }));
for (const asp of [0.5625, 0.75, 1, 1.3333])
  same(`tilt aspect ${asp}`, jsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }, asp), tsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }, asp));
same('rearmDwell', jsImpl.rearmDwell(), tsImpl.rearmDwell());
for (const asp of [0.5625, 0.75, 1, 1.3333])
  for (const x of [0.4, 0.5, 0.6])
    same(`yaw ${x} aspect ${asp}`, jsImpl.yawFromLandmarks({ x, y: 0.6 }, { x: 0.3, y: 0.52 }, { x: 0.7, y: 0.47 }, asp), tsImpl.yawFromLandmarks({ x, y: 0.6 }, { x: 0.3, y: 0.52 }, { x: 0.7, y: 0.47 }, asp));
for (const baseline of [undefined, { gaze: 0.2, yaw: -0.1 }])
  for (const gaze of [-0.2, 0, 0.2])
    for (const yaw of [-0.1, 0, 0.1])
      same(`look ${gaze} ${yaw}`, jsImpl.lookFromSignals(gaze, yaw, baseline), tsImpl.lookFromSignals(gaze, yaw, baseline));


// Exercise the generated page's real calibration/frame handler without opening a camera or
// downloading a model. Only replace auto-start with a test hook; the detection code is unchanged.
function cameraPage(mode, storage = new Map()) {
  const scripts = [...buildHandsFreeHtml(mode).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 3);
  assert.ok(scripts[2].includes('  start();'));
  scripts[2] = scripts[2].replace('  start();', '  window.testFrames = { handle: handle, calibrate: startCalib };');
  const messages = [];
  const window = {
    ReactNativeWebView: { postMessage: (m) => messages.push(JSON.parse(m)) }, addEventListener() {},
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  const visibility = {};
  const document = { hidden: false, addEventListener: (name, fn) => { visibility[name] = fn; }, getElementById: () => ({ videoWidth: 480, videoHeight: 640 }) };
  new Function('window', 'document', scripts.join('\n'))(window, document);
  return { window, messages, storage, document, visibility };
}

for (const mode of ['look', 'tilt']) {
  const { window, messages, storage } = cameraPage(mode);
  const setMode = (m) => new Function('window', handsFreeModeScript(m))(window);
  const answers = () => messages.filter((m) => m.type === 'answer').map((m) => m.liked);
  const latest = () => messages.filter((m) => m.type === 'progress').at(-1);
  assert.deepEqual(messages.find((m) => m.type === 'ready'), { type: 'ready', swapSides: false, session: 0, revision: 0 });
  // The ready handshake must override a stale initial HTML mode before calibration too.
  setMode(mode === 'look' ? 'tilt' : 'look');
  assert.equal(latest().mode, mode === 'look' ? 'tilt' : 'look');
  setMode(mode);
  assert.equal(latest().mode, mode);
  let now = 0;
  const neutral = { gaze: 0.18, yaw: -0.08, tilt: 4 };
  const frame = (signal) => {
    const lm = [];
    const dy = Math.tan(signal.tilt * Math.PI / 180) * 0.4 * (480 / 640) / 2;
    lm[33] = { x: 0.3, y: 0.5 - dy };
    lm[263] = { x: 0.7, y: 0.5 + dy };
    // User's own right moves the nose toward image-LEFT in raw front-camera frames.
    const eyeDistance = Math.hypot(0.4 * (480 / 640), 2 * dy);
    lm[1] = { x: 0.5 - signal.yaw * eyeDistance / (480 / 640), y: 0.6 };
    const categories = (signal.gaze >= 0 ? ['eyeLookInLeft', 'eyeLookOutRight'] : ['eyeLookOutLeft', 'eyeLookInRight'])
      .map((categoryName) => ({ categoryName, score: Math.abs(signal.gaze) }));
    return { faceLandmarks: [lm], faceBlendshapes: [{ categories }] };
  };
  const hold = (signal, ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 100)
      window.testFrames.handle(frame({ ...neutral, ...signal }), now += 100);
  };
  window.testFrames.calibrate();
  hold({}, 2200);
  assert.ok(messages.some((m) => m.state === 'tracking'), 'calibration completes');
  hold({}, 1500);
  assert.deepEqual(answers(), [], 'calibrated gaze and yaw offset must stay neutral');
  // Only the selected axis reacts; Look cannot silently keep using Tilt (or vice versa).
  hold(mode === 'look' ? { tilt: neutral.tilt + 25 } : { gaze: 0.6, yaw: 0.2 }, 1500);
  assert.deepEqual(answers(), [], `${mode}: ignore the other mode's movement`);
  hold({}, 500);
  hold(mode === 'look' ? { gaze: neutral.gaze + 0.03 } : { tilt: neutral.tilt + 3 }, 100);
  assert.ok(latest().signal > 0 && latest().signal < 1, 'live meter reacts below dwell threshold');
  assert.equal(latest().zone, 'center');
  assert.equal(latest().mode, mode);
  assert.equal(latest().value, 0);
  hold({}, 500);
  const right = mode === 'look' ? { gaze: neutral.gaze + 0.06, yaw: neutral.yaw + 0.06 } : { tilt: neutral.tilt + 16 };
  const left = mode === 'look' ? { yaw: neutral.yaw - 0.1 } : { tilt: neutral.tilt - 16 };
  const dwellMs = tsImpl.TUNING[mode].dwellMs;
  hold(right, 200);
  new Function('window', handsFreeContextScript(0, 1))(window);
  hold(right, 2000);
  assert.deepEqual(answers(), [], 'manual/card context reset cannot carry the previous hold');
  hold({}, 500);
  hold(right, 200);
  now += 5000;
  hold(right, 2000);
  assert.deepEqual(answers(), [], 'actual page cannot count a camera frame gap as hold time');
  hold({}, 500);
  hold(right, dwellMs);
  assert.deepEqual(answers(), [], `${mode}: no early answer`);
  hold(right, 100);
  assert.deepEqual(answers(), [true], `${mode}: user's own right = Yes`);
  assert.ok(messages.some((m) => m.type === 'progress' && m.side === 'right' && m.value > 0.4 && m.value < 0.8));
  hold(right, 1500);
  hold(left, 1500);
  assert.deepEqual(answers(), [true], 'holding or switching sides never re-arms');
  hold({}, 300);
  hold(left, 1500);
  assert.deepEqual(answers(), [true], 'brief center cannot re-arm');
  hold({}, 500);
  hold(left, dwellMs + 100);
  assert.deepEqual(answers(), [true, false], `${mode}: user's own left = No after re-arm`);
  if (mode === 'look') {
    hold({}, 500);
    hold({ gaze: neutral.gaze + 0.15 }, dwellMs + 100);
    assert.deepEqual(answers(), [true, false, true], 'eyes alone can answer after re-arm');
  }
  // Switch in the same page (no reload/recalibration). A held side must first return to center.
  const nextMode = mode === 'look' ? 'tilt' : 'look';
  const nextRight = nextMode === 'look' ? { yaw: neutral.yaw + 0.11 } : { tilt: neutral.tilt + 17 };
  const beforeSwitch = answers().length;
  setMode(nextMode);
  assert.equal(latest().mode, nextMode);
  assert.equal(latest().signal, 0);
  hold(nextRight, 2000);
  assert.equal(answers().length, beforeSwitch, 'mode change re-arms only after center');
  assert.equal(latest().zone, 'right', 'meter sees the held direction even while re-arming');
  assert.equal(latest().side, null);
  hold({}, 500);
  // Movement from the old mode no longer works.
  hold(right, 1500);
  assert.equal(answers().length, beforeSwitch, 'mode switch changes the actual signal source');
  hold({}, 500);
  hold(nextRight, tsImpl.TUNING[nextMode].dwellMs + 100);
  assert.equal(answers().at(-1), true);
  assert.equal(answers().length, beforeSwitch + 1);
  assert.equal(latest().mode, nextMode);

  // Swap applies AFTER baseline subtraction to meter, zone and answer, with the same center gate.
  window.__hf.setSwapSides(true);
  assert.equal([...storage.values()][0], 'true');
  hold(nextRight, 2000);
  assert.equal(answers().length, beforeSwitch + 1, 'swap also requires center');
  assert.equal(latest().zone, 'left');
  assert.equal(latest().signal, -1);
  hold({}, 500);
  hold(nextRight, tsImpl.TUNING[nextMode].dwellMs + 100);
  assert.equal(answers().at(-1), false, 'Swap sides reverses the answer');
  const restarted = cameraPage(nextMode, storage);
  assert.equal(restarted.messages.find((m) => m.type === 'ready').swapSides, true, 'swap survives a page remount');
  restarted.window.__hf.setSwapSides(false);
  assert.equal(cameraPage(mode, storage).messages.find((m) => m.type === 'ready').swapSides, false);

  // Losing a face clears the diagnostic instead of leaving a stale right/left reading.
  window.testFrames.handle({ faceLandmarks: [] }, now += 100);
  assert.equal(latest().signal, 0);
  assert.equal(latest().zone, 'center');
  for (const message of messages) assert.ok(parsePageMessage(JSON.stringify(message)), 'every emitted message passes the native parser');
  n++;
}

// Native mode taps and readiness replay share the tested injection command and current ref.
const panelSource = readFileSync(join(here, '../components/onboarding/HandsFree.tsx'), 'utf8');
assert.match(panelSource, /modeRef.current = m/);
assert.match(panelSource, /injectJavaScript\(handsFreeModeScript\(modeRef.current\)\)/);
assert.match(panelSource, /if \(m.mode !== modeRef.current\) return/);
assert.match(panelSource, /isCurrentPageMessage\(m, context\)/);
assert.match(panelSource, /Seeing: \{meter.zone\}/);
assert.match(pageSource, /outputFaceBlendshapes: true/);
assert.match(pageSource, /detectForVideo\(video, now\)/, 'MediaPipe receives raw video, not CSS-mirrored pixels');
const progress = { session: 0, revision: 0, type: 'progress', side: null, value: 0, signal: 0.2, zone: 'center', mode: 'look' };
assert.deepEqual(parsePageMessage(JSON.stringify(progress)), progress);
assert.equal(parsePageMessage(JSON.stringify({ ...progress, mode: 'bogus' })), null);
assert.equal(parsePageMessage(JSON.stringify({ ...progress, signal: null })), null);
assert.deepEqual(parsePageMessage('{"session":0,"revision":0,"type":"answer","liked":true,"mode":"look"}'), { session: 0, revision: 0, type: 'answer', liked: true, mode: 'look' });
assert.equal(parsePageMessage('{"type":"answer","liked":true,"mode":"bogus"}'), null);
assert.equal(parsePageMessage('{"type":"progress","side":null,"value":0,"signal":1e999,"zone":"center","mode":"look"}'), null);
n++;


// Interrupted observations must fail closed in both the TypeScript and injected implementation.
for (const impl of [tsImpl, jsImpl]) {
  for (const mode of ['look', 'tilt']) {
    for (const badNow of [6100, 900, NaN, Infinity, -Infinity]) {
      let r = impl.stepDwell(impl.initialDwell(), 'right', 1000, impl.TUNING[mode].dwellMs, 400);
      r = impl.stepDwell(r.state, 'right', 1100, impl.TUNING[mode].dwellMs, 400);
      r = impl.stepDwell(r.state, 'right', badNow, impl.TUNING[mode].dwellMs, 400);
      assert.equal(r.fired, null); assert.equal(r.progress, 0); assert.equal(r.state.needsCenter, true);
      let t = Number.isFinite(badNow) ? badNow : 1200;
      for (let i = 0; i < 30; i++) {
        r = impl.stepDwell(r.state, 'right', t += 100, impl.TUNING[mode].dwellMs, 400);
        assert.equal(r.fired, null, 'side stays locked until observed center');
      }
      for (let i = 0; i < 6; i++) r = impl.stepDwell(r.state, 'center', t += 100, impl.TUNING[mode].dwellMs, 400);
      assert.equal(r.state.needsCenter, false); n++;
    }
  }
}
const message = { session: 2, revision: 3, type: 'answer', mode: 'look', liked: true };
for (const context of [{ session: 1, revision: 3, live: true }, { session: 2, revision: 4, live: true }, { session: 2, revision: 3, live: false }]) {
  assert.equal(isCurrentPageMessage(message, context), false, 'old session/revision or stopped input is rejected'); n++;
}
assert.equal(isCurrentPageMessage(message, { session: 2, revision: 3, live: true }), true);
assert.equal(parsePageMessage('{"type":"answer","liked":true,"mode":"look"}'), null, 'untagged answers fail closed');
const page = cameraPage('look');
new Function('window', handsFreeContextScript(0, 7))(page.window);
assert.equal(page.messages.at(-1).revision, 7);
new Function('window', handsFreeContextScript(0, 6))(page.window);
assert.equal(page.messages.at(-1).revision, 7, 'stale commands cannot roll revision backward');
page.document.hidden = true;
page.visibility.visibilitychange();
const count = page.messages.length;
page.window.testFrames.handle({ faceLandmarks: [] }, 10000);
assert.equal(page.messages.length, count, 'hidden page cannot produce answers or tracking frames');
n++;
console.log(`handsfree: all checks passed (${n} parity/behaviour groups, TS + injected JS)`);
