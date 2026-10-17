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
const { buildHandsFreeHtml, handsFreeModeScript, parsePageMessage } = await import(pathToFileURL(pageFile).href);
rmSync(dir, { recursive: true, force: true });

const names = ['TUNING', 'GAZE_SIGN', 'TILT_SIGN', 'gazeFromBlendshapes', 'lookFromSignals', 'smoothLook', 'tiltFromLandmarks', 'classify', 'initialDwell', 'rearmDwell', 'stepDwell'];
const jsImpl = new Function(`${tsImpl.HANDSFREE_CORE_JS}; return { ${names.join(', ')} };`)();

let n = 0;
const same = (label, a, b) => {
  assert.deepEqual(a, b, `TS and injected JS differ: ${label}`);
  n++;
};

same('TUNING', jsImpl.TUNING, tsImpl.TUNING);
same('GAZE_SIGN', jsImpl.GAZE_SIGN, tsImpl.GAZE_SIGN);
same('TILT_SIGN', jsImpl.TILT_SIGN, tsImpl.TILT_SIGN);
same(jsImpl.YAW_SIGN, tsImpl.YAW_SIGN);

for (const impl of [tsImpl, jsImpl]) {
  const { gazeFromBlendshapes, lookFromSignals, smoothLook, tiltFromLandmarks, classify, initialDwell, rearmDwell, stepDwell, TUNING } = impl;

  // Gaze: looking to the person's right (= screen right, ❤️) is positive; clamped to [-1, 1].
  assert.ok(gazeFromBlendshapes({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.6 }) > 0.5);
  assert.ok(gazeFromBlendshapes({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }) < -0.5);
  assert.equal(gazeFromBlendshapes({}), 0);
  assert.equal(gazeFromBlendshapes({ eyeBlinkLeft: 1, eyeBlinkRight: 1, eyeLookUpLeft: 1, eyeLookDownRight: 1 }), 0, 'only the four horizontal eye-gaze blendshapes contribute');
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

  // Phone-distance eyes-only tuning; Tilt and the center gate retain their original settings.
  const L = TUNING.look;
  assert.deepEqual(L, { threshold: 0.09, hysteresis: 0.03, dwellMs: 1000, alpha: 0.35 });
  assert.deepEqual(TUNING.tilt, { dwellMs: 800, threshold: 15, hysteresis: 3 });
  assert.equal(TUNING.rearmMs, 400);
  assert.equal(TUNING.calibrateMs, 2000);
  const zoneOf = (v, prev = 'center') => classify(v, prev, L.threshold, L.hysteresis);
  assert.equal(zoneOf(0), 'center');
  assert.equal(zoneOf(0.10), 'right');
  assert.equal(zoneOf(-0.10), 'left');
  assert.equal(zoneOf(0.09), 'center'); // not enough to enter
  assert.equal(zoneOf(-0.09), 'center');
  assert.equal(zoneOf(0.07, 'right'), 'right'); // enough to stay
  assert.equal(zoneOf(-0.07, 'left'), 'left');
  assert.equal(zoneOf(0.05, 'right'), 'center');
  assert.equal(zoneOf(-0.05, 'left'), 'center');
  assert.equal(zoneOf(-0.10, 'right'), 'left');
  assert.equal(classify(20, 'center', 15, 3), 'right');

  for (const direction of [-1, 1]) {
    const wanted = direction === 1 ? 'right' : 'left';
    assert.equal(zoneOf(lookFromSignals(direction * 0.10)), wanted);
    assert.equal(zoneOf(lookFromSignals(0.2 + direction * 0.10, 0.2)), wanted);
  }
  assert.equal(lookFromSignals(0.2, 0.2), 0);
  assert.equal(zoneOf(lookFromSignals(0.25, 0.2)), 'center');
  assert.ok(Math.abs(smoothLook(0.1, 0) - 0.035) < 1e-9);
  assert.ok(Math.abs(smoothLook(0.1, 0.035) - 0.05775) < 1e-9);
  assert.equal(zoneOf(smoothLook(0.2, 0)), 'center', 'one eye spike is smoothed below threshold');

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

  // Look fires at 1 second, never before, and needs the center before another answer.
  let exact = stepDwell(initialDwell(), 'right', 0, L.dwellMs, TUNING.rearmMs);
  exact = stepDwell(exact.state, 'right', 999, L.dwellMs, TUNING.rearmMs);
  assert.equal(exact.fired, null);
  assert.ok(exact.progress > 0.99);
  exact = stepDwell(exact.state, 'right', 1000, L.dwellMs, TUNING.rearmMs);
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
  assert.equal(log.find((r, i) => i > 0 && log[i - 1].side === null && r.side === 'right' && i > 100).progress < 0.05, true);

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
for (const baseline of [undefined, 0.2])
  for (const gaze of [-0.2, 0, 0.2])
    same(`look ${gaze} baseline ${baseline}`, jsImpl.lookFromSignals(gaze, baseline), tsImpl.lookFromSignals(gaze, baseline));
let tsSmoothed = 0, jsSmoothed = 0;
for (const value of [0, 0.12, 0.12, 0.12, -0.15, 0, 0, 0.3]) {
  tsSmoothed = tsImpl.smoothLook(value, tsSmoothed);
  jsSmoothed = jsImpl.smoothLook(value, jsSmoothed);
  same(`EMA trace ${value}`, jsSmoothed, tsSmoothed);
}

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
  const document = { getElementById: () => ({ videoWidth: 480, videoHeight: 640 }) };
  new Function('window', 'document', scripts.join('\n'))(window, document);
  return { window, messages, storage };
}

for (const mode of ['look', 'tilt']) {
  const { window, messages, storage } = cameraPage(mode);
  const setMode = (m) => new Function('window', handsFreeModeScript(m))(window);
  const answers = () => messages.filter((m) => m.type === 'answer').map((m) => m.liked);
  const latest = () => messages.filter((m) => m.type === 'progress').at(-1);
  assert.deepEqual(messages.find((m) => m.type === 'ready'), { type: 'ready', swapSides: false });
  // The ready handshake must override a stale initial HTML mode before calibration too.
  setMode(mode === 'look' ? 'tilt' : 'look');
  assert.equal(latest().mode, mode === 'look' ? 'tilt' : 'look');
  setMode(mode);
  assert.equal(latest().mode, mode);
  let now = 0;
  let neutral = { gaze: 0.18, yaw: -0.08, tilt: 4 };
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
  // Brief outliers must not bias the median baseline.
  hold({ gaze: 0.8, yaw: 0.7, tilt: 35 }, 200);
  hold({}, 2200);
  assert.ok(messages.some((m) => m.state === 'tracking'), 'calibration completes');
  hold({}, 1500);
  assert.deepEqual(answers(), [], 'calibrated active signal must stay neutral');
  assert.ok(Math.abs(latest().reading) < 1e-9, 'median calibration rejects outliers');
  // Each foreign signal, alone and combined, must never answer in either direction.
  const foreign = mode === 'look'
    ? [{ tilt: 35 }, { yaw: 0.7 }, { tilt: -35 }, { yaw: -0.7 }, { tilt: 30, yaw: 0.7 }]
    : [{ gaze: 0.7 }, { gaze: -0.7 }, { yaw: 0.7 }, { gaze: 0.7, yaw: -0.7 }];
  for (const movement of foreign) {
    hold(movement, 2000);
    assert.deepEqual(answers(), [], `${mode}: ignore ${JSON.stringify(movement)}`);
    assert.equal(latest().zone, 'center');
    assert.ok(Math.abs(latest().reading) < 1e-9);
  }
  hold({}, 1200);
  hold(mode === 'look' ? { gaze: neutral.gaze + 0.03 } : { tilt: neutral.tilt + 3 }, 100);
  assert.ok(latest().signal > 0 && latest().signal < 1, 'live meter reacts below dwell threshold');
  assert.ok(Math.abs(latest().reading - (mode === 'look' ? 0.03 * 0.35 : 3)) < 1e-9, 'meter uses the active signal, including Look EMA');
  assert.equal(latest().zone, 'center');
  assert.equal(latest().mode, mode);
  assert.equal(latest().value, 0);
  hold({}, 1200);
  const right = mode === 'look' ? { gaze: neutral.gaze + 0.10 } : { tilt: neutral.tilt + 16 };
  const left = mode === 'look' ? { gaze: neutral.gaze - 0.10 } : { tilt: neutral.tilt - 16 };
  const dwellMs = tsImpl.TUNING[mode].dwellMs;
  const settleMs = mode === 'look' ? 600 : 100;
  hold(right, dwellMs);
  assert.deepEqual(answers(), [], `${mode}: no early answer`);
  hold(right, settleMs);
  assert.deepEqual(answers(), [true], `${mode}: user's own right = Yes`);
  assert.ok(messages.some((m) => m.type === 'progress' && m.side === 'right' && m.value > 0.4 && m.value < 0.8));
  const previousReading = latest().reading;
  hold(mode === 'look' ? { gaze: neutral.gaze + 0.25 } : { tilt: neutral.tilt + 30 }, 100);
  assert.ok(latest().reading > previousReading + 0.02, 'numeric reading keeps updating beyond the visual meter limit');
  hold(right, 1500);
  hold(left, 1500);
  assert.deepEqual(answers(), [true], 'holding or switching sides never re-arms');
  hold({}, 300);
  hold(left, 1500);
  assert.deepEqual(answers(), [true], 'brief center cannot re-arm');
  hold({}, 1200);
  hold(left, dwellMs + settleMs);
  assert.deepEqual(answers(), [true, false], `${mode}: user's own left = No after re-arm`);

  // Switching sources starts fresh calibration without reloading the WebView. Reset the
  // calibration in flight too, proving the old signal's samples/time cannot leak across modes.
  const nextMode = mode === 'look' ? 'tilt' : 'look';
  const beforeSwitch = answers().length;
  setMode(nextMode);
  assert.equal(latest().mode, nextMode);
  assert.equal(latest().signal, 0);
  assert.equal(latest().reading, 0);
  assert.equal(messages.at(-1).state, 'calibrating');
  hold({ gaze: 0.8, tilt: 35 }, 1200);
  setMode(mode);
  hold({ gaze: -0.8, tilt: -35 }, 1200);
  setMode(nextMode);
  neutral = { gaze: -0.12, yaw: 0.2, tilt: -6 };
  hold({}, 1200);
  assert.equal(messages.filter((m) => m.type === 'status').at(-1).state, 'calibrating', 'mode switch resets the calibration window');
  hold({}, 1000);
  assert.equal(messages.filter((m) => m.type === 'status').at(-1).state, 'tracking');
  const nextRight = nextMode === 'look' ? { gaze: neutral.gaze + 0.10 } : { tilt: neutral.tilt + 17 };
  const nextSettleMs = nextMode === 'look' ? 600 : 100;
  hold(nextRight, 2000);
  assert.equal(answers().length, beforeSwitch, 'mode change re-arms only after center');
  assert.equal(latest().zone, 'right', 'meter sees the held direction even while re-arming');
  assert.equal(latest().side, null);
  hold({}, 1200);
  assert.ok(Math.abs(latest().reading) < 0.005, 'new mode uses its fresh median baseline and cleared EMA (within meter rounding)');
  // Movement from the old mode no longer works (test with the new neutral baseline).
  hold(mode === 'look' ? { gaze: neutral.gaze + 0.4, yaw: -0.7 } : { tilt: neutral.tilt + 35, yaw: 0.7 }, 2000);
  assert.equal(answers().length, beforeSwitch, 'mode switch changes the actual signal source');
  assert.equal(latest().zone, 'center');
  hold({}, 1200);
  hold(nextRight, tsImpl.TUNING[nextMode].dwellMs + nextSettleMs);
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
  hold({}, 1200);
  hold(nextRight, tsImpl.TUNING[nextMode].dwellMs + nextSettleMs);
  assert.equal(answers().at(-1), false, 'Swap sides reverses the answer');
  const restarted = cameraPage(nextMode, storage);
  assert.equal(restarted.messages.find((m) => m.type === 'ready').swapSides, true, 'swap survives a page remount');
  restarted.window.__hf.setSwapSides(false);
  assert.equal(cameraPage(mode, storage).messages.find((m) => m.type === 'ready').swapSides, false);

  // Losing a face clears the diagnostic instead of leaving a stale right/left reading.
  window.testFrames.handle({ faceLandmarks: [] }, now += 100);
  assert.equal(latest().signal, 0);
  assert.equal(latest().reading, 0);
  assert.equal(latest().zone, 'center');
  for (const message of messages) assert.ok(parsePageMessage(JSON.stringify(message)), 'every emitted message passes the native parser');
  n++;
}

// Native mode taps and readiness replay share the tested injection command and current ref.
const panelSource = readFileSync(join(here, '../components/onboarding/HandsFree.tsx'), 'utf8');
assert.match(panelSource, /modeRef.current = m/);
assert.match(panelSource, /injectJavaScript\(handsFreeModeScript\(modeRef.current\)\)/);
assert.match(panelSource, /if \(m.mode !== modeRef.current\) return/);
assert.match(panelSource, /if \(m.mode === modeRef.current\) answer\(m.liked\)/);
assert.match(panelSource, /Seeing: \{meter.zone\}/);
assert.match(panelSource, /Look \(eyes\)/);
assert.match(panelSource, /Tilt \(head\)/);
assert.match(panelSource, /'Eyes' : 'Tilt'/);
assert.match(panelSource, /meter.reading.toFixed\(2\)/);
assert.doesNotMatch(pageSource, /yawFromLandmarks|lm\[1\]/, 'head yaw never enters either signal');
assert.match(pageSource, /outputFaceBlendshapes: true/);
assert.match(pageSource, /detectForVideo\(video, now\)/, 'MediaPipe receives raw video, not CSS-mirrored pixels');
const progress = { type: 'progress', side: null, value: 0, signal: 0.2, reading: 0.018, zone: 'center', mode: 'look' };
assert.deepEqual(parsePageMessage(JSON.stringify(progress)), progress);
assert.equal(parsePageMessage(JSON.stringify({ ...progress, mode: 'bogus' })), null);
assert.equal(parsePageMessage(JSON.stringify({ ...progress, signal: null })), null);
assert.equal(parsePageMessage(JSON.stringify({ ...progress, reading: null })), null);
assert.deepEqual(parsePageMessage('{"type":"answer","liked":true,"mode":"look"}'), { type: 'answer', liked: true, mode: 'look' });
assert.equal(parsePageMessage('{"type":"answer","liked":true,"mode":"bogus"}'), null);
assert.equal(parsePageMessage('{"type":"progress","side":null,"value":0,"signal":1e999,"zone":"center","mode":"look"}'), null);
n++;

console.log(`handsfree: all checks passed (${n} parity/behaviour groups, TS + injected JS)`);
