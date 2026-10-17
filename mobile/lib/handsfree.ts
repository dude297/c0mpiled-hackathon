// Hands-free answering for the interest cards: look toward ✕ / ❤️, or tilt your head toward it.
// Pure logic only (no React, no camera). The camera + MediaPipe run inside a WebView
// (components/onboarding/HandsFree.tsx); that page can't import this module, so HANDSFREE_CORE_JS
// below is a plain-JS twin of these functions. scripts/check-handsfree.mjs runs the same test
// vectors against both — change one, change the other, then run `node scripts/check-handsfree.mjs`.

export type Mode = 'look' | 'tilt';
export type Zone = 'left' | 'center' | 'right'; // left = ✕ (no), right = ❤️ (yes) — screen sides

// Look combines eye gaze with head yaw (nose offset / inter-eye distance). A small glance or
// turn should be enough on a phone; hysteresis and return-to-center keep holds deliberate.
// Tilt remains in degrees with its original tuning.
export const TUNING = {
  look: { dwellMs: 1200, threshold: 0.14, hysteresis: 0.04, yawWeight: 1.5 },
  tilt: { dwellMs: 800, threshold: 15, hysteresis: 3 },
  rearmMs: 400, // must look/hold back at the middle this long before the next answer
  calibrateMs: 2000, // "look at the middle" step at start
} as const;

// Sign conventions, in one place so a device test can flip them with one character.
// Gaze: MediaPipe blendshapes follow ARKit naming (the subject's own left/right eye), so
// "looking to my right" is already "looking at the screen's right" — no flip.
// Tilt: landmarks are in raw (un-mirrored) camera pixels, where the person's right side is on the
// image's left, so tilting toward the screen's right makes the raw roll negative — flip it.
export const GAZE_SIGN = 1;
// Yaw uses raw, un-mirrored landmarks too: a turn toward screen right moves the nose left
// in the camera image. The mirrored preview is CSS-only; flip the raw offset exactly once.
export const YAW_SIGN = -1;
export const TILT_SIGN = -1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Horizontal gaze in [-1, 1], positive = toward the screen's right (❤️). Input: blendshape
// categoryName → score. Rightward = left eye looking in + right eye looking out.
export function gazeFromBlendshapes(b: Record<string, number>): number {
  const g = (k: string) => b[k] ?? 0;
  const right = g('eyeLookInLeft') + g('eyeLookOutRight');
  const left = g('eyeLookOutLeft') + g('eyeLookInRight');
  return clamp((GAZE_SIGN * (right - left)) / 2, -1, 1);
}

// Head yaw proxy: nose tip (1) relative to the midpoint of the outer eye corners (33/263),
// normalized by their aspect-corrected distance. Positive = toward screen right (❤️).
export function yawFromLandmarks(nose: { x: number; y: number }, p33: { x: number; y: number }, p263: { x: number; y: number }, aspect = 1): number {
  const eyeDistance = Math.hypot((p263.x - p33.x) * aspect, p263.y - p33.y);
  if (eyeDistance < 1e-6) return 0;
  const offset = (nose.x - (p33.x + p263.x) / 2) * aspect;
  return clamp((YAW_SIGN * offset) / eyeDistance, -1, 1);
}

export function lookFromSignals(gaze: number, yaw: number, baseline = { gaze: 0, yaw: 0 }): number {
  return gaze - baseline.gaze + TUNING.look.yawWeight * (yaw - baseline.yaw);
}

// Head roll in degrees from the outer eye corners (landmarks 33 and 263, normalized x/y),
// positive = tilted toward the screen's right (❤️). aspect = frame width / height: landmarks are
// normalized per axis, so without it a 480x640 portrait frame reads ~19.7° of real roll as 15°.
export function tiltFromLandmarks(p33: { x: number; y: number }, p263: { x: number; y: number }, aspect = 1): number {
  const deg = (Math.atan2(p263.y - p33.y, (p263.x - p33.x) * aspect) * 180) / Math.PI;
  return TILT_SIGN * deg;
}

// Zone with hysteresis: entering a side needs |v| > threshold; staying needs |v| > threshold - hysteresis.
export function classify(v: number, prev: Zone, threshold: number, hysteresis: number): Zone {
  const keep = threshold - hysteresis;
  if (prev === 'left' && v < -keep) return 'left';
  if (prev === 'right' && v > keep) return 'right';
  if (v < -threshold) return 'left';
  if (v > threshold) return 'right';
  return 'center';
}

export type DwellState = {
  side: 'left' | 'right' | null; // side currently being held
  since: number; // when that hold started (ms)
  needsCenter: boolean; // just answered: wait for the middle before arming again
  centerSince: number | null;
};

export type DwellStep = {
  state: DwellState;
  side: 'left' | 'right' | null;
  progress: number; // 0..1 for the fill on `side`
  fired: 'left' | 'right' | null; // an answer happened on this frame
};

export const initialDwell = (): DwellState => ({ side: null, since: 0, needsCenter: false, centerSince: null });
// After a Look/Tilt switch: wait for the middle before answering, so a head already turned or tilted
// to one side can't fire straight away under the new mode.
export const rearmDwell = (): DwellState => ({ side: null, since: 0, needsCenter: true, centerSince: null });

// One frame of the dwell machine. zone = null means no face (resets the hold).
export function stepDwell(s: DwellState, zone: Zone | null, now: number, dwellMs: number, rearmMs: number): DwellStep {
  if (zone === null) {
    return { state: { ...s, side: null, since: now, centerSince: null }, side: null, progress: 0, fired: null };
  }
  if (s.needsCenter) {
    if (zone !== 'center') return { state: { ...s, side: null, centerSince: null }, side: null, progress: 0, fired: null };
    const centerSince = s.centerSince ?? now;
    const rearmed = now - centerSince >= rearmMs;
    return {
      state: { side: null, since: now, needsCenter: !rearmed, centerSince: rearmed ? null : centerSince },
      side: null,
      progress: 0,
      fired: null,
    };
  }
  if (zone === 'center') return { state: { ...s, side: null, since: now }, side: null, progress: 0, fired: null };
  const since = s.side === zone ? s.since : now;
  const progress = Math.min(1, (now - since) / dwellMs);
  if (progress >= 1) {
    return { state: { side: null, since: now, needsCenter: true, centerSince: null }, side: null, progress: 0, fired: zone };
  }
  return { state: { ...s, side: zone, since }, side: zone, progress, fired: null };
}

// Plain-JS twin of everything above, injected into the WebView page. Keep in sync (see top).
export const HANDSFREE_CORE_JS = String.raw`
var TUNING = {
  look: { dwellMs: 1200, threshold: 0.14, hysteresis: 0.04, yawWeight: 1.5 },
  tilt: { dwellMs: 800, threshold: 15, hysteresis: 3 },
  rearmMs: 400,
  calibrateMs: 2000
};
var GAZE_SIGN = 1;
var YAW_SIGN = -1;
var TILT_SIGN = -1;
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function gazeFromBlendshapes(b) {
  function g(k) { return b[k] == null ? 0 : b[k]; }
  var right = g('eyeLookInLeft') + g('eyeLookOutRight');
  var left = g('eyeLookOutLeft') + g('eyeLookInRight');
  return clamp((GAZE_SIGN * (right - left)) / 2, -1, 1);
}
function yawFromLandmarks(nose, p33, p263, aspect) {
  if (aspect == null) aspect = 1;
  var eyeDistance = Math.hypot((p263.x - p33.x) * aspect, p263.y - p33.y);
  if (eyeDistance < 1e-6) return 0;
  var offset = (nose.x - (p33.x + p263.x) / 2) * aspect;
  return clamp((YAW_SIGN * offset) / eyeDistance, -1, 1);
}
function lookFromSignals(gaze, yaw, baseline) {
  if (baseline == null) baseline = { gaze: 0, yaw: 0 };
  return gaze - baseline.gaze + TUNING.look.yawWeight * (yaw - baseline.yaw);
}
function tiltFromLandmarks(p33, p263, aspect) {
  if (aspect == null) aspect = 1;
  var deg = (Math.atan2(p263.y - p33.y, (p263.x - p33.x) * aspect) * 180) / Math.PI;
  return TILT_SIGN * deg;
}
function classify(v, prev, threshold, hysteresis) {
  var keep = threshold - hysteresis;
  if (prev === 'left' && v < -keep) return 'left';
  if (prev === 'right' && v > keep) return 'right';
  if (v < -threshold) return 'left';
  if (v > threshold) return 'right';
  return 'center';
}
function initialDwell() { return { side: null, since: 0, needsCenter: false, centerSince: null }; }
function rearmDwell() { return { side: null, since: 0, needsCenter: true, centerSince: null }; }
function stepDwell(s, zone, now, dwellMs, rearmMs) {
  if (zone === null) {
    return { state: { side: null, since: now, needsCenter: s.needsCenter, centerSince: null }, side: null, progress: 0, fired: null };
  }
  if (s.needsCenter) {
    if (zone !== 'center') return { state: { side: null, since: s.since, needsCenter: true, centerSince: null }, side: null, progress: 0, fired: null };
    var centerSince = s.centerSince == null ? now : s.centerSince;
    var rearmed = now - centerSince >= rearmMs;
    return { state: { side: null, since: now, needsCenter: !rearmed, centerSince: rearmed ? null : centerSince }, side: null, progress: 0, fired: null };
  }
  if (zone === 'center') return { state: { side: null, since: now, needsCenter: false, centerSince: s.centerSince }, side: null, progress: 0, fired: null };
  var since = s.side === zone ? s.since : now;
  var progress = Math.min(1, (now - since) / dwellMs);
  if (progress >= 1) {
    return { state: { side: null, since: now, needsCenter: true, centerSince: null }, side: null, progress: 0, fired: zone };
  }
  return { state: { side: zone, since: since, needsCenter: false, centerSince: s.centerSince }, side: zone, progress: progress, fired: null };
}
`;
