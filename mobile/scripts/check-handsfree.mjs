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
rmSync(dir, { recursive: true, force: true });

const names = ['TUNING', 'GAZE_SIGN', 'TILT_SIGN', 'gazeFromBlendshapes', 'tiltFromLandmarks', 'classify', 'initialDwell', 'rearmDwell', 'stepDwell'];
const jsImpl = new Function(`${tsImpl.HANDSFREE_CORE_JS}; return { ${names.join(', ')} };`)();

let n = 0;
const same = (label, a, b) => {
  assert.deepEqual(a, b, `TS and injected JS differ: ${label}`);
  n++;
};

same('TUNING', jsImpl.TUNING, tsImpl.TUNING);
same('GAZE_SIGN', jsImpl.GAZE_SIGN, tsImpl.GAZE_SIGN);
same('TILT_SIGN', jsImpl.TILT_SIGN, tsImpl.TILT_SIGN);

for (const impl of [tsImpl, jsImpl]) {
  const { gazeFromBlendshapes, tiltFromLandmarks, classify, initialDwell, rearmDwell, stepDwell, TUNING } = impl;

  // Gaze: looking to the person's right (= screen right, ❤️) is positive; clamped to [-1, 1].
  assert.ok(gazeFromBlendshapes({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.6 }) > 0.5);
  assert.ok(gazeFromBlendshapes({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }) < -0.5);
  assert.equal(gazeFromBlendshapes({}), 0);
  assert.equal(gazeFromBlendshapes({ eyeLookInLeft: 9, eyeLookOutRight: 9 }), 1);

  // Tilt: raw image, person's right eye corner (33) on the image left. Tilting toward the screen's
  // right drops 33 lower in the image (bigger y) → positive (❤️).
  assert.ok(Math.abs(tiltFromLandmarks({ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 })) < 1e-9);
  assert.ok(tiltFromLandmarks({ x: 0.3, y: 0.6 }, { x: 0.7, y: 0.4 }) > 15);
  assert.ok(tiltFromLandmarks({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.6 }) < -15);

  // Aspect ratio: a real 15° roll in a 480x640 portrait frame (pixels) must read as 15°, not ~11.5°
  // (and in a 640x480 landscape frame, not ~19.7°).
  const rollFrame = (deg, w, h) => {
    const r = (deg * Math.PI) / 180, cx = w / 2, cy = h / 2, half = 60; // eye corners 120 px apart
    // Positive = toward the screen's right = 33 lower in the raw image (see TILT_SIGN).
    return [{ x: (cx - half * Math.cos(r)) / w, y: (cy + half * Math.sin(r)) / h }, { x: (cx + half * Math.cos(r)) / w, y: (cy - half * Math.sin(r)) / h }];
  };
  for (const [w, h] of [[480, 640], [640, 480], [720, 1280]]) {
    const [a, b] = rollFrame(15, w, h);
    assert.ok(Math.abs(tiltFromLandmarks(a, b, w / h) - 15) < 1e-6, `15° roll reads 15° at ${w}x${h}`);
    assert.ok(Math.abs(tiltFromLandmarks(a, b) - 15) > 2, `uncorrected ${w}x${h} is off (proves the fix matters)`);
  }
  assert.equal(classify(tiltFromLandmarks(...rollFrame(14, 480, 640), 480 / 640), 'center', TUNING.tilt.threshold, TUNING.tilt.hysteresis), 'center');
  assert.equal(classify(tiltFromLandmarks(...rollFrame(16, 480, 640), 480 / 640), 'center', TUNING.tilt.threshold, TUNING.tilt.hysteresis), 'right');

  // Zones + hysteresis.
  const L = TUNING.look;
  assert.equal(classify(0, 'center', L.threshold, L.hysteresis), 'center');
  assert.equal(classify(0.3, 'center', L.threshold, L.hysteresis), 'right');
  assert.equal(classify(-0.3, 'center', L.threshold, L.hysteresis), 'left');
  assert.equal(classify(0.2, 'center', L.threshold, L.hysteresis), 'center'); // not enough to enter
  assert.equal(classify(0.2, 'right', L.threshold, L.hysteresis), 'right'); // but enough to stay
  assert.equal(classify(0.1, 'right', L.threshold, L.hysteresis), 'center');
  assert.equal(classify(-0.2, 'left', L.threshold, L.hysteresis), 'left');
  assert.equal(classify(20, 'center', 15, 3), 'right');

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
  let log = run([['center', 200], ['right', 1600]], 1500);
  assert.deepEqual(fires(log), ['right']);
  const mid = log.find((r) => r.side === 'right' && r.progress > 0.45 && r.progress < 0.55);
  assert.ok(mid, 'progress passes 0.5 on the way');

  // Holding after firing never repeats.
  log = run([['right', 5000]], 1500);
  assert.deepEqual(fires(log), ['right']);

  // A short glance back to the middle (< 400 ms) doesn't re-arm.
  log = run([['right', 1600], ['center', 300], ['right', 2000]], 1500);
  assert.deepEqual(fires(log), ['right']);

  // Back to the middle for ≥ 400 ms re-arms → second answer.
  log = run([['right', 1600], ['center', 500], ['left', 1600]], 1500);
  assert.deepEqual(fires(log), ['right', 'left']);

  // Switching sides restarts the hold; too short on each side → nothing.
  log = run([['left', 1000], ['right', 1000], ['left', 1000]], 1500);
  assert.deepEqual(fires(log), []);

  // Losing the face resets progress.
  log = run([['right', 1000], [null, 100], ['right', 1000]], 1500);
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
      const r = impl.stepDwell(s, zone, (t += 16), 1500, 400);
      s = r.state;
      outp.push(r);
    }
  return outp;
};
same('stepDwell trace', trace(jsImpl), trace(tsImpl));
for (const v of [-1.2, -0.3, -0.2, 0, 0.2, 0.3, 1.2])
  for (const p of ['left', 'center', 'right']) same(`classify ${v} ${p}`, jsImpl.classify(v, p, 0.25, 0.07), tsImpl.classify(v, p, 0.25, 0.07));
const bs = { eyeLookInLeft: 0.3, eyeLookOutRight: 0.1, eyeLookOutLeft: 0.05, eyeLookInRight: 0.2 };
same('gaze', jsImpl.gazeFromBlendshapes(bs), tsImpl.gazeFromBlendshapes(bs));
same('tilt', jsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }), tsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }));
for (const asp of [0.5625, 0.75, 1, 1.3333])
  same(`tilt aspect ${asp}`, jsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }, asp), tsImpl.tiltFromLandmarks({ x: 0.31, y: 0.52 }, { x: 0.69, y: 0.47 }, asp));
same('rearmDwell', jsImpl.rearmDwell(), tsImpl.rearmDwell());

console.log(`handsfree: all checks passed (${n} parity/behaviour groups, TS + injected JS)`);
