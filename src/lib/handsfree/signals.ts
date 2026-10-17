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
 * That holds no matter how the preview is mirrored. `swap` flips the result if a device reports
 * the opposite convention (exposed in the UI as "Swap sides").
 */
export function gazeFromBlendshapes(shapes: readonly Blendshape[], swap = false): number {
  const s = (name: string) => shapes.find((b) => b.categoryName === name)?.score ?? 0;
  const towardRight = s("eyeLookInLeft") + s("eyeLookOutRight");
  const towardLeft = s("eyeLookOutLeft") + s("eyeLookInRight");
  const value = clamp1((towardRight - towardLeft) / 2);
  return swap ? -value : value;
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
export function classifyZone(value: number, prev: Zone, threshold: number, hysteresis: number): Zone {
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
  look: { threshold: 0.25, hysteresis: 0.07, dwellMs: 1500 },
  tilt: { threshold: 15, hysteresis: 4, dwellMs: 800 },
};

export const CALIBRATION_MS = 2000;
export const REARM_MS = 400;
