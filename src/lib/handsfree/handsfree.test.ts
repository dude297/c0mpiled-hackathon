import { describe, expect, it } from "vitest";
import { initialDwell, stepDwell, type DwellState } from "./dwell";
import {
  classifyZone,
  combineLook,
  gazeFromBlendshapes,
  initialCalibration,
  median,
  MODE_CONFIG,
  REARM_MS,
  rollFromEyeCorners,
  stepCalibration,
  yawFromLandmarks,
  type SignalSample,
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
  it("keeps a nonfinite blendshape unusable instead of turning it into a full-strength gaze", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const gaze = gazeFromBlendshapes(shapes({ eyeLookInLeft: value, eyeLookOutRight: 0.2 }));
      expect(Number.isNaN(gaze)).toBe(true);
      expect(classifyZone(combineLook({ gaze, yaw: 0 }, { gaze: 0, yaw: 0 }), "center", 0.14, 0.04)).toBeNull();
    }
  });
});

describe("yawFromLandmarks", () => {
  const a = { x: 0.4, y: 0.5 };
  const b = { x: 0.6, y: 0.5 };

  it("centers at the eye midpoint and maps a raw-frame left nose shift to screen right / Yes", () => {
    expect(yawFromLandmarks({ x: 0.5, y: 0.6 }, a, b)).toBeCloseTo(0);
    expect(yawFromLandmarks({ x: 0.46, y: 0.6 }, a, b)).toBeCloseTo(0.2);
    expect(yawFromLandmarks({ x: 0.54, y: 0.6 }, a, b)).toBeCloseTo(-0.2);
    expect(yawFromLandmarks({ x: 0.46, y: 0.6 }, b, a)).toBeCloseTo(0.2);
  });

  it("normalizes by eye distance, independent of face scale and position", () => {
    expect(yawFromLandmarks({ x: 0.28, y: 0.45 }, { x: 0.25, y: 0.4 }, { x: 0.35, y: 0.4 }))
      .toBeCloseTo(yawFromLandmarks({ x: 0.46, y: 0.6 }, a, b)!);
  });

  it("aspect-corrects both the horizontal offset and the slanted inter-eye distance", () => {
    const nose = { x: 0.46, y: 0.6 };
    const tilted = { x: 0.6, y: 0.65 };
    expect(yawFromLandmarks(nose, a, tilted, 2)).toBeCloseTo(0.08 / Math.hypot(0.4, 0.15));
    // Same physical coordinates, normalized for a frame twice as wide.
    expect(yawFromLandmarks({ x: 0.23, y: 0.6 }, { x: 0.2, y: 0.5 }, { x: 0.3, y: 0.65 }, 2))
      .toBeCloseTo(yawFromLandmarks(nose, a, tilted, 1)!);
  });

  it("rejects degenerate or invalid geometry rather than reporting a centered face", () => {
    expect(yawFromLandmarks(a, a, a)).toBeNull();
    expect(yawFromLandmarks({ x: NaN, y: 0.5 }, a, b)).toBeNull();
    expect(yawFromLandmarks(a, a, { x: Infinity, y: 0.5 })).toBeNull();
    for (const aspect of [0, -1, Infinity]) expect(yawFromLandmarks(a, a, b, aspect)).toBeNull();
  });

  it("rejects overflow from finite coordinates instead of treating it as a face", () => {
    expect(yawFromLandmarks({ x: 0, y: 0 }, { x: -1e308, y: 0 }, { x: 1e308, y: 0 })).toBeNull();
    expect(yawFromLandmarks({ x: -1e308, y: 0 }, { x: 1e308, y: 0 }, { x: 1e308, y: 1 })).toBeNull();
  });
});

describe("combineLook", () => {
  const base = { gaze: 0.05, yaw: -0.03 };

  it("removes the calibrated gaze and yaw offsets", () => {
    expect(combineLook(base, base)).toBe(0);
    expect(combineLook({ gaze: 0.09, yaw: 0.07 }, base)).toBeCloseTo(0.14);
  });

  it("allows either eye movement or head turning to select a side", () => {
    expect(combineLook({ gaze: 0.25, yaw: base.yaw }, base)).toBeCloseTo(0.2);
    expect(combineLook({ gaze: base.gaze, yaw: -0.23 }, base)).toBeCloseTo(-0.2);
  });

  it("uses the combined sign when eyes and head point in opposite directions", () => {
    expect(combineLook({ gaze: -0.1, yaw: 0.3 }, { gaze: 0, yaw: 0 })).toBeCloseTo(0.2);
    expect(combineLook({ gaze: 0.1, yaw: -0.3 }, { gaze: 0, yaw: 0 })).toBeCloseTo(-0.2);
    expect(combineLook({ gaze: 0.2, yaw: -0.2 }, { gaze: 0, yaw: 0 })).toBe(0);
  });

  it("rejects nonfinite signals instead of clamping infinity into an intentional answer", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Number.isNaN(combineLook({ gaze: value, yaw: 0 }, base))).toBe(true);
      expect(Number.isNaN(combineLook({ gaze: 0, yaw: value }, base))).toBe(true);
      expect(Number.isNaN(combineLook(base, { gaze: value, yaw: 0 }))).toBe(true);
    }
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
  it("treats invalid signals as lost tracking, which cannot rearm or finish a dwell", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const zone = classifyZone(value, "right", T, H);
      expect(zone).toBeNull();
      const half = run([...frames("center", 0, 400), ...frames("right", 500, 1000)]);
      const invalid = stepDwell(half.state, zone, 1100, MODE_CONFIG.look.dwellMs, REARM_MS);
      expect(invalid.state.armed).toBe(false);
      expect(invalid.progress).toBe(0);
      expect(run(frames("right", 1200, 4000), MODE_CONFIG.look.dwellMs, invalid.state).fired).toEqual([]);
    }
  });
  it("enters a side only past the threshold", () => {
    expect(T).toBeGreaterThanOrEqual(0.12);
    expect(T).toBeLessThanOrEqual(0.15);
    for (const value of [-T, -0.12, 0, 0.12, T]) expect(classifyZone(value, "center", T, H)).toBe("center");
    expect(classifyZone(T + 0.001, "center", T, H)).toBe("right");
    expect(classifyZone(-T - 0.001, "center", T, H)).toBe("left");
  });
  it("stays on a side until clearly back toward center", () => {
    expect(classifyZone(T - H / 2, "right", T, H)).toBe("right");
    expect(classifyZone(T - H, "right", T, H)).toBe("center");
    expect(classifyZone(-T + H / 2, "left", T, H)).toBe("left");
    expect(classifyZone(-(T - H), "left", T, H)).toBe("center");
    expect(classifyZone(T + 0.001, "left", T, H)).toBe("right");
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
    expect(r.last.progress).toBe(0);
    expect(r.state.armed).toBe(false);
  });

  it("requires center again after a lost face, even if the returning face keeps looking at a target", () => {
    const r = run([
      ...frames("center", 0, 400), ...frames("right", 500, 1800), [null, 1900],
      ...frames("right", 2000, 4000), ...frames("center", 4100, 4500),
      ...frames("left", 4600, 6100),
    ]);
    expect(r.fired).toEqual(["left@6100"]);
  });

  it("does not turn a stalled camera or suspended tab into an answer", () => {
    const r = run([...frames("center", 0, 400), ...frames("right", 500, 1200), ["right", 5000]]);
    expect(r.fired).toEqual([]);
    expect(r.last.progress).toBe(0);
    expect(r.state.armed).toBe(false);
  });

  for (const mode of ["look", "tilt"] as const) {
    const { dwellMs } = MODE_CONFIG[mode];

    it(`${mode}: stays paused after a tracking gap until center and a fresh full dwell`, () => {
      const r = run([
        ...frames("center", 0, 400), ...frames("right", 500, 1000),
        ...frames("right", 3000, 5000), // tracking returns, but center is still required
        ...frames("center", 5100, 5500),
        ...frames("left", 5600, 5600 + dwellMs),
      ], dwellMs);
      expect(r.fired).toEqual([`left@${5600 + dwellMs}`]);
    });

    it(`${mode}: preserves deliberate answers on a lower-frame-rate device`, () => {
      const r = run([
        ...frames("center", 0, 400, 200),
        ...frames("right", 600, 2400, 200),
      ], dwellMs);
      expect(r.fired).toEqual([`right@${600 + Math.ceil(dwellMs / 200) * 200}`]);
    });
  }

  it("does not count a gap between two center frames as time spent rearming", () => {
    const r = run([["center", 0], ["center", 5000], ["right", 5100], ...frames("right", 5200, 7000)]);
    expect(r.fired).toEqual([]);
  });

  it("rejects invalid and backwards timestamps without keeping a partial answer", () => {
    const half = run([...frames("center", 0, 400), ...frames("right", 500, 1200)]);
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 100]) {
      const step = stepDwell(half.state, "right", t, 1500, REARM_MS);
      expect(step.fired).toBeNull();
      expect(step.progress).toBe(0);
      expect(step.state.armed).toBe(false);
      // A bad timestamp must not poison future tracking or remove the center requirement.
      const continued = run([
        ...frames("right", 1300, 3000), ...frames("center", 3100, 3500),
        ...frames("left", 3600, 5100),
      ], 1500, step.state);
      expect(continued.fired).toEqual(["left@5100"]);
    }
  });
});

describe("stepCalibration", () => {
  const feed = (samples: [number, SignalSample | null][]) => {
    let c = initialCalibration();
    let last = stepCalibration(c, 0, null);
    for (const [t, s] of samples) {
      last = stepCalibration(c, t, s);
      c = last.calib;
    }
    return last;
  };
  const ticks = (from: number, to: number, s: SignalSample | null, every = 33) => {
    const out: [number, SignalSample | null][] = [];
    for (let t = from; t <= to; t += every) out.push([t, s]);
    return out;
  };

  it("does not count time with no face, and never shows 0 while waiting", () => {
    const r = feed(ticks(0, 5000, null));
    expect(r.base).toBeNull();
    expect(r.secondsLeft).toBe(2);
  });
  it("a face found late still gets a full 2 s of samples", () => {
    const r1 = feed([...ticks(0, 1900, null), ...ticks(2000, 2300, { gaze: 0.1, yaw: -0.04, tilt: 2 })]);
    expect(r1.base).toBeNull();
    expect(r1.secondsLeft).toBeGreaterThanOrEqual(1);
    const r2 = feed([...ticks(0, 1900, null), ...ticks(2000, 4100, { gaze: 0.1, yaw: -0.04, tilt: 2 })]);
    expect(r2.base).toEqual({ gaze: 0.1, yaw: -0.04, tilt: 2 });
  });
  it("a long stall counts for at most 100 ms", () => {
    const r = feed([[0, { gaze: 0, yaw: 0, tilt: 0 }], [5000, { gaze: 0, yaw: 0, tilt: 0 }]]);
    expect(r.calib.faceMs).toBe(100);
    expect(r.base).toBeNull();
  });
  it("uses median yaw so one calibration outlier does not bias Look mode", () => {
    const normal = { gaze: 0.1, yaw: -0.04, tilt: 2 };
    const r = feed([[0, { ...normal, yaw: 0.9 }], ...ticks(100, 2100, normal, 100)]);
    expect(r.base).toEqual(normal);
    expect(combineLook(normal, r.base!)).toBe(0);
  });

  it("does not finish calibration using nonfinite gaze, yaw or tilt samples", () => {
    for (const field of ["gaze", "yaw", "tilt"] as const) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const r = feed(ticks(0, 3000, { gaze: 0, yaw: 0, tilt: 0, [field]: value }, 100));
        expect(r.base).toBeNull();
        expect(r.calib.faceMs).toBe(0);
        expect(r.calib.gaze).toEqual([]);
      }
    }
  });

  it("recovers from an invalid clock without poisoning the finite baseline", () => {
    const neutral = { gaze: 0.1, yaw: -0.04, tilt: 2 };
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      const r = feed([[t, neutral], ...ticks(0, 2100, neutral, 100)]);
      expect(r.base).toEqual(neutral);
      expect(Number.isFinite(r.calib.faceMs)).toBe(true);
    }
  });

  it("does not count backwards time or an invalid sample toward calibration", () => {
    const neutral = { gaze: 0.1, yaw: -0.04, tilt: 2 };
    const first = stepCalibration(initialCalibration(), 100, neutral).calib;
    for (const [t, sample] of [[50, neutral], [200, { ...neutral, yaw: Number.NaN }]] as const) {
      const invalid = stepCalibration(first, t, sample);
      expect(invalid.calib).toEqual({ ...first, lastT: null });
      expect(invalid.base).toBeNull();
      const resumed = stepCalibration(invalid.calib, 300, neutral);
      expect(resumed.calib.faceMs).toBe(first.faceMs);
    }
  });
});

describe("calibrated Look mode dwell", () => {
  const cfg = MODE_CONFIG.look;
  const base = { gaze: 0.05, yaw: -0.03 };
  const center = { ...base };
  // Neither signal alone crosses the threshold; together they select screen right / Yes.
  const right = { gaze: base.gaze + 0.08, yaw: base.yaw + 0.08 };
  const left = { gaze: base.gaze - 0.08, yaw: base.yaw - 0.08 };

  // Continuous tracking: gaps over 500ms intentionally disarm dwell after PR #55.
  const lookFrames = (sample: typeof base, from: number, to: number): [typeof base, number][] =>
    frames("center", from, to).map(([, t]) => [sample, t]);

  const runLook = (samples: [typeof base | null, number][]) => {
    let state = initialDwell();
    let zone: Zone = "center";
    const fired: string[] = [];
    let last: ReturnType<typeof stepDwell> = stepDwell(state, null, 0, cfg.dwellMs, REARM_MS);
    for (const [sample, t] of samples) {
      const next: Zone | null = sample ? classifyZone(combineLook(sample, base), zone, cfg.threshold, cfg.hysteresis) : null;
      zone = next ?? "center";
      last = stepDwell(state, next, t, cfg.dwellMs, REARM_MS);
      state = last.state;
      if (last.fired) fired.push(`${last.fired}@${t}`);
    }
    return { last, fired };
  };

  it("shows the selected side during a 1.2s dwell, then fires right = Yes", () => {
    expect(cfg.dwellMs).toBe(1200);
    const samples = [...lookFrames(center, 0, REARM_MS), ...lookFrames(right, 500, 1100)];
    const half = runLook(samples);
    expect(half.last.side).toBe("right");
    expect(half.last.progress).toBeCloseTo(0.5);
    expect(half.fired).toEqual([]);
    const almost = [...samples, ...lookFrames(right, 1200, 1600)];
    expect(runLook([...almost, [right, 1699]]).fired).toEqual([]);
    expect(runLook([...almost, [right, 1700]]).fired).toEqual(["right@1700"]);
  });

  it("does not re-arm by holding or switching sides; needs 400ms continuously at center", () => {
    const samples: [typeof base | null, number][] = [
      ...lookFrames(center, 0, REARM_MS), ...lookFrames(right, 500, 3000),
      ...lookFrames(left, 3100, 5000),
      ...lookFrames(center, 5100, 5400), [center, 5499], ...lookFrames(left, 5500, 7000),
      [center, 7100], [center, 7300], [null, 7400], [center, 7500], [center, 7899],
    ];
    const unarmed = runLook(samples);
    expect(unarmed.last.state.armed).toBe(false);
    expect(unarmed.fired).toEqual(["right@1700"]);
    const result = runLook([...samples, [center, 7900], ...lookFrames(left, 8000, 9200)]);
    expect(result.fired).toEqual(["right@1700", "left@9200"]);
  });

  it("keeps a dwell through hysteresis jitter, then clears its side and progress at center", () => {
    const jitter = { gaze: base.gaze + 0.06, yaw: base.yaw + 0.06 };
    const samples = [...lookFrames(center, 0, REARM_MS), ...lookFrames(right, 500, 500), ...lookFrames(jitter, 600, 1100)];
    expect(runLook(samples).last.side).toBe("right");
    expect(runLook(samples).last.progress).toBeCloseTo(0.5);
    const result = runLook([...samples, [center, 1200]]);
    expect(result.last.side).toBeNull();
    expect(result.last.progress).toBe(0);
    expect(result.fired).toEqual([]);
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
