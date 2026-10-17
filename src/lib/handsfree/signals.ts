// Pure signal math for hands-free answering. No DOM, no MediaPipe imports — just numbers.
// Sign convention everywhere: positive = toward the SCREEN's right (❤️), negative = left (✕).

export type Side = "left" | "right";
export type Zone = Side | "center";

export type Blendshape = { categoryName: string; score: number };
export type Point = { x: number; y: number };

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Horizontal gaze in [-1, 1] from MediaPipe face blendshapes.
 * MediaPipe names blendshapes from the person's own point of view (ARKit style): "Left" is the
 * person's left eye; "In" = toward the nose, "Out" = toward the ear. Someone facing the screen who
 * looks at the screen's right is looking to THEIR right: left eye moves in, right eye moves out.
 * That holds no matter how the preview is mirrored (detection runs on the raw, un-mirrored frame).
 * Verified against @mediapipe/tasks-vision 0.10.14 on real photos: a person looking toward their
 * own left gave eyeLookOutLeft 0.83 / eyeLookInRight 0.82, and the mirrored photo flipped them.
 * `swap` flips the result as a manual escape hatch (exposed in the UI as "Swap sides").
 */
export function gazeFromBlendshapes(shapes: readonly Blendshape[], swap = false): number {
  const s = (name: string) => shapes.find((b) => b.categoryName === name)?.score ?? 0;
  const towardRight = s("eyeLookInLeft") + s("eyeLookOutRight");
  const towardLeft = s("eyeLookOutLeft") + s("eyeLookInRight");
  const raw = (towardRight - towardLeft) / 2;
  if (!Number.isFinite(raw)) return Number.NaN;
  const value = clamp1(raw);
  return swap ? -value : value;
}

/**
 * Horizontal head yaw: nose tip (1) relative to the midpoint of eye corners (33/263),
 * divided by their distance in aspect-corrected image coordinates. In the raw camera
 * frame a turn toward the screen's right moves the nose left, hence the minus sign.
 * This is a relative signal, not an angle; calibration removes the resting offset.
 * Invalid / coincident landmarks are unusable samples, never a centered face.
 */
export function yawFromLandmarks(nose: Point, a: Point, b: Point, aspect = 4 / 3): number | null {
  if (![nose.x, nose.y, a.x, a.y, b.x, b.y, aspect].every(Number.isFinite) || aspect <= 0) return null;
  const eyeDistance = Math.hypot((b.x - a.x) * aspect, b.y - a.y);
  if (!Number.isFinite(eyeDistance) || eyeDistance < 1e-6) return null;
  const yaw = -((nose.x - (a.x + b.x) / 2) * aspect) / eyeDistance;
  return Number.isFinite(yaw) ? yaw : null;
}

export type LookSignal = { gaze: number; yaw: number };

/** Eye movement and head turning contribute together; their combined sign selects the side. */
export function combineLook(sample: LookSignal, base: LookSignal): number {
  const value = (sample.gaze - base.gaze) + (sample.yaw - base.yaw);
  // Preserve unusable input as invalid, so classifyZone drops tracking instead of arming at center.
  return Number.isFinite(value) ? clamp1(value) : Number.NaN;
}

/**
 * Head roll in degrees from the outer eye corners (landmarks 33 and 263), in the raw
 * (un-mirrored) camera image. Positive = head tilted toward the screen's right (❤️).
 * In the raw image the person's right eye sits on the image's left. Tilting toward their right
 * shoulder (= the screen's right, as they face it) drops that eye, which makes the image-space
 * angle negative — so we negate it. Points are normalized [0,1]; `aspect` = width / height.
 */
export function rollFromEyeCorners(a: Point, b: Point, aspect = 4 / 3, swap = false): number {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  const angle = (Math.atan2(r.y - l.y, (r.x - l.x) * aspect) * 180) / Math.PI;
  const value = -angle;
  return swap ? -value : value;
}

/** Zone with hysteresis: enter a side past +/-threshold, return to center only below threshold - hysteresis. */
export function classifyZone(value: number, prev: Zone, threshold: number, hysteresis: number): Zone | null {
  if (!Number.isFinite(value)) return null;
  if (value > threshold) return "right";
  if (value < -threshold) return "left";
  if (prev === "right" && value > threshold - hysteresis) return "right";
  if (prev === "left" && value < -(threshold - hysteresis)) return "left";
  return "center";
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type HandsFreeMode = "look" | "tilt";

export const MODE_CONFIG: Record<HandsFreeMode, { threshold: number; hysteresis: number; dwellMs: number }> = {
  look: { threshold: 0.14, hysteresis: 0.04, dwellMs: 1200 },
  tilt: { threshold: 15, hysteresis: 4, dwellMs: 800 },
};

export const CALIBRATION_MS = 2000;
export const REARM_MS = 400;

export type SignalSample = LookSignal & { tilt: number };
export type Calibration = { faceMs: number; lastT: number | null; gaze: number[]; yaw: number[]; tilt: number[] };
export type CalibrationStep = { calib: Calibration; secondsLeft: number; base: SignalSample | null };

export const initialCalibration = (): Calibration => ({ faceMs: 0, lastT: null, gaze: [], yaw: [], tilt: [] });

/**
 * "Look at the middle" baseline. Only time with a face in view counts toward CALIBRATION_MS, so a
 * face found late still gets a full 2 s of samples and the countdown never sits at 0 while waiting.
 * A single gap between frames counts for at most 100 ms (a hidden tab or a stall can't skip ahead).
 * Returns the median baseline once done, else null.
 */
export function stepCalibration(
  c: Calibration,
  t: number,
  sample: SignalSample | null,
): CalibrationStep {
  const left = (ms: number) => Math.max(1, Math.ceil((CALIBRATION_MS - ms) / 1000));
  if (!sample || !Number.isFinite(t) || t < 0 || (c.lastT !== null && t < c.lastT)
    || ![sample.gaze, sample.yaw, sample.tilt].every(Number.isFinite)) {
    const calib = { ...c, lastT: null };
    return { calib, secondsLeft: left(c.faceMs), base: null };
  }
  const faceMs = c.faceMs + (c.lastT === null ? 0 : Math.min(100, Math.max(0, t - c.lastT)));
  const calib = { faceMs, lastT: t, gaze: [...c.gaze, sample.gaze], yaw: [...c.yaw, sample.yaw], tilt: [...c.tilt, sample.tilt] };
  const done = faceMs >= CALIBRATION_MS && calib.gaze.length >= 10;
  return {
    calib,
    secondsLeft: left(faceMs),
    base: done ? { gaze: median(calib.gaze), yaw: median(calib.yaw), tilt: median(calib.tilt) } : null,
  };
}
