import { describe, expect, it } from "vitest";
import { initialDwell, stepDwell, type DwellState } from "./dwell";
import {
  classifyZone,
  gazeFromBlendshapes,
  initialCalibration,
  median,
  MODE_CONFIG,
  REARM_MS,
  rollFromEyeCorners,
  stepCalibration,
  type Zone,
} from "./signals";

const shapes = (o: Record<string, number>) => Object.entries(o).map(([categoryName, score]) => ({ categoryName, score }));

describe("gazeFromBlendshapes", () => {
  it("looking at the screen's right (person's right) is positive", () => {
    expect(gazeFromBlendshapes(shapes({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.6 }))).toBeCloseTo(0.6);
  });
  it("looking at the screen's left is negative", () => {
    expect(gazeFromBlendshapes(shapes({ eyeLookOutLeft: 0.5, eyeLookInRight: 0.5 }))).toBeCloseTo(-0.5);
  });
  it("matches real MediaPipe 0.10.14 output (subject's point of view)", () => {
    // Recorded from FaceLandmarker on real photos. Person looking toward THEIR right (irises toward
    // the raw image's left) = the screen's right for someone facing the screen.
    const theirRight = shapes({ eyeLookInLeft: 0.321, eyeLookOutLeft: 0.01, eyeLookInRight: 0.02, eyeLookOutRight: 0.322 });
    const theirLeft = shapes({ eyeLookInLeft: 0.001, eyeLookOutLeft: 0.826, eyeLookInRight: 0.816, eyeLookOutRight: 0.003 });
    expect(gazeFromBlendshapes(theirRight)).toBeGreaterThan(0.25);
    expect(gazeFromBlendshapes(theirLeft)).toBeLessThan(-0.25);
  });
  it("straight ahead / missing shapes is 0, swap flips sign, result is clamped", () => {
    expect(gazeFromBlendshapes([])).toBe(0);
    expect(gazeFromBlendshapes(shapes({ eyeLookInLeft: 0.4, eyeLookOutRight: 0.4 }), true)).toBeCloseTo(-0.4);
    expect(gazeFromBlendshapes(shapes({ eyeLookInLeft: 3, eyeLookOutRight: 3 }))).toBe(1);
  });
});

describe("rollFromEyeCorners", () => {
  // Raw camera image: person's right eye (landmark 33) is on the image's left.
  const level = { r33: { x: 0.4, y: 0.5 }, l263: { x: 0.6, y: 0.5 } };
  it("level head is ~0", () => {
    expect(rollFromEyeCorners(level.r33, level.l263, 1)).toBeCloseTo(0);
  });
  it("tilting toward the person's right shoulder (screen right) is positive", () => {
    // Person's right eye drops (larger y), left eye rises.
    const deg = rollFromEyeCorners({ x: 0.4, y: 0.56 }, { x: 0.6, y: 0.44 }, 1);
    expect(deg).toBeGreaterThan(15);
  });
  it("tilting toward the screen's left is negative, regardless of point order", () => {
    const a = { x: 0.4, y: 0.44 };
    const b = { x: 0.6, y: 0.56 };
    expect(rollFromEyeCorners(a, b, 1)).toBeLessThan(-15);
    expect(rollFromEyeCorners(b, a, 1)).toBeCloseTo(rollFromEyeCorners(a, b, 1));
  });
  it("accounts for aspect ratio", () => {
    // dy = 0.1, dx = 0.1 normalized; on a 4:3 frame the real angle is atan(0.1 / 0.133)
    expect(rollFromEyeCorners({ x: 0.4, y: 0.6 }, { x: 0.5, y: 0.5 }, 4 / 3)).toBeCloseTo(36.87, 1);
  });
});

describe("classifyZone (hysteresis)", () => {
  const { threshold: T, hysteresis: H } = MODE_CONFIG.look;
  it("enters a side only past the threshold", () => {
    expect(classifyZone(0.2, "center", T, H)).toBe("center");
    expect(classifyZone(0.3, "center", T, H)).toBe("right");
    expect(classifyZone(-0.3, "center", T, H)).toBe("left");
  });
  it("stays on a side until clearly back toward center", () => {
    expect(classifyZone(0.2, "right", T, H)).toBe("right");
    expect(classifyZone(0.1, "right", T, H)).toBe("center");
    expect(classifyZone(-0.2, "left", T, H)).toBe("left");
    expect(classifyZone(0.3, "left", T, H)).toBe("right");
  });
});

describe("median", () => {
  it("handles empty, odd, even", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

// Run a sequence of [zone, t] samples and collect what fired.
function run(samples: [Zone | null, number][], dwellMs = 1500, start: DwellState = initialDwell()) {
  let state = start;
  const fired: string[] = [];
  let last = { progress: 0 };
  for (const [zone, t] of samples) {
    const step = stepDwell(state, zone, t, dwellMs, REARM_MS);
    state = step.state;
    last = step;
    if (step.fired) fired.push(`${step.fired}@${t}`);
  }
  return { state, fired, last };
}

const frames = (zone: Zone | null, from: number, to: number, every = 100): [Zone | null, number][] => {
  const out: [Zone | null, number][] = [];
  for (let t = from; t <= to; t += every) out.push([zone, t]);
  return out;
};

describe("stepDwell", () => {
  it("needs center for 400ms before the first answer can count", () => {
    expect(run(frames("right", 0, 3000)).fired).toEqual([]);
    const r = run([...frames("center", 0, 400), ...frames("right", 500, 2000)]);
    expect(r.fired).toEqual(["right@2000"]);
  });

  it("exposes progress 0..1 while dwelling", () => {
    const r = run([...frames("center", 0, 400), ...frames("left", 500, 1250, 50)]);
    expect(r.last.progress).toBeCloseTo(0.5);
    expect(r.fired).toEqual([]);
  });

  it("tilt dwell is shorter (800ms)", () => {
    const r = run([...frames("center", 0, 400), ...frames("left", 500, 1300)], MODE_CONFIG.tilt.dwellMs);
    expect(r.fired).toEqual(["left@1300"]);
  });

  it("does not repeat while still held; re-arms after 400ms back at center", () => {
    const r = run([
      ...frames("center", 0, 400),
      ...frames("right", 500, 5000), // fires once at 2000, then holding does nothing
      ...frames("center", 5100, 5400), // only 300ms of center: not re-armed yet
      ...frames("right", 5500, 7500),
    ]);
    expect(r.fired).toEqual(["right@2000"]);

    const r2 = run([
      ...frames("center", 0, 400),
      ...frames("right", 500, 2000),
      ...frames("center", 2100, 2500), // 400ms center
      ...frames("left", 2600, 4100),
    ]);
    expect(r2.fired).toEqual(["right@2000", "left@4100"]);
  });

  it("switching sides restarts the dwell", () => {
    const r = run([...frames("center", 0, 400), ...frames("right", 500, 1500), ...frames("left", 1600, 2900)]);
    expect(r.fired).toEqual([]);
    expect(r.last.progress).toBeCloseTo(1300 / 1500);
  });

  it("dropping to center resets progress", () => {
    const r = run([...frames("center", 0, 400), ...frames("right", 500, 1800), ["center", 1900], ...frames("right", 2000, 3000)]);
    expect(r.fired).toEqual([]);
  });

  it("losing the face resets progress", () => {
    const r = run([...frames("center", 0, 400), ...frames("right", 500, 1800), [null, 1900], ...frames("right", 2000, 3000)]);
    expect(r.fired).toEqual([]);
    expect(r.last.progress).toBeCloseTo(1000 / 1500);
  });
});

describe("stepCalibration", () => {
  const feed = (samples: [number, { gaze: number; tilt: number } | null][]) => {
    let c = initialCalibration();
    let last = stepCalibration(c, 0, null);
    for (const [t, s] of samples) {
      last = stepCalibration(c, t, s);
      c = last.calib;
    }
    return last;
  };
  const ticks = (from: number, to: number, s: { gaze: number; tilt: number } | null, every = 33) => {
    const out: [number, { gaze: number; tilt: number } | null][] = [];
    for (let t = from; t <= to; t += every) out.push([t, s]);
    return out;
  };

  it("does not count time with no face, and never shows 0 while waiting", () => {
    const r = feed(ticks(0, 5000, null));
    expect(r.base).toBeNull();
    expect(r.secondsLeft).toBe(2);
  });
  it("a face found late still gets a full 2 s of samples", () => {
    const r1 = feed([...ticks(0, 1900, null), ...ticks(2000, 2300, { gaze: 0.1, tilt: 2 })]);
    expect(r1.base).toBeNull();
    expect(r1.secondsLeft).toBeGreaterThanOrEqual(1);
    const r2 = feed([...ticks(0, 1900, null), ...ticks(2000, 4100, { gaze: 0.1, tilt: 2 })]);
    expect(r2.base).toEqual({ gaze: 0.1, tilt: 2 });
  });
  it("a long stall counts for at most 100 ms", () => {
    const r = feed([[0, { gaze: 0, tilt: 0 }], [5000, { gaze: 0, tilt: 0 }]]);
    expect(r.calib.faceMs).toBe(100);
    expect(r.base).toBeNull();
  });
});

describe("dwell after a card changed some other way", () => {
  it("a fresh unarmed state cannot fire until the person returns to center", () => {
    // Half-held right dwell, then the card changes by tap: component swaps in initialDwell().
    const half = run([...frames("center", 0, 400), ...frames("right", 500, 1500)]);
    expect(half.fired).toEqual([]);
    const after = run(frames("right", 1600, 4000), 1500, initialDwell());
    expect(after.fired).toEqual([]);
  });
});
