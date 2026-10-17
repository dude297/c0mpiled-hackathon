"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { initialDwell, stepDwell, type DwellState } from "@/lib/handsfree/dwell";
import {
  CALIBRATION_MS,
  classifyZone,
  gazeFromBlendshapes,
  median,
  MODE_CONFIG,
  REARM_MS,
  rollFromEyeCorners,
  type Blendshape,
  type HandsFreeMode,
  type Point,
  type Side,
  type Zone,
} from "@/lib/handsfree/signals";

// MediaPipe is loaded at runtime from a pinned CDN build — not an npm dependency.
const MP_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
export const MP_MODULE_URL = `${MP_BASE}/vision_bundle.mjs`;
export const MP_WASM_URL = `${MP_BASE}/wasm`;
export const MP_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const LOAD_TIMEOUT_MS = 25000;

type FaceResult = { faceLandmarks?: Point[][]; faceBlendshapes?: { categories: Blendshape[] }[] };
type Landmarker = { detectForVideo(video: HTMLVideoElement, timestamp: number): FaceResult };
type VisionModule = {
  FilesetResolver: { forVisionTasks(wasmPath: string): Promise<unknown> };
  FaceLandmarker: { createFromOptions(fileset: unknown, options: object): Promise<Landmarker> };
};

let landmarkerPromise: Promise<Landmarker> | null = null;

// MediaPipe's wasm loader binds console.error once, while the model is created, and later prints
// harmless "INFO: ..." lines through it (the Next dev overlay shows them as errors). Hand it a
// filter during creation that drops only those lines and forwards everything else.
async function withInfoFilter<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO:")) return;
    original(...args);
  };
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

function loadLandmarker(): Promise<Landmarker> {
  landmarkerPromise ??= withInfoFilter(async () => {
    const vision = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ MP_MODULE_URL)) as VisionModule;
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM_URL);
    const create = (delegate: "GPU" | "CPU") =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    return create("GPU").catch(() => create("CPU"));
  }).catch((error) => {
    landmarkerPromise = null; // allow a retry on the next Start
    throw error;
  });
  return landmarkerPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

const STILL_WORKS = "The Yes and No buttons still work.";

function cameraMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return `Camera permission is turned off. To use hands-free, allow the camera (look for the camera icon next to the web address), then press Start again. ${STILL_WORKS}`;
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return `We couldn't find a camera on this device. ${STILL_WORKS}`;
  if (name === "NotReadableError" || name === "AbortError")
    return `Your camera is busy in another app. Close that app, then press Start again. ${STILL_WORKS}`;
  return `The camera couldn't start. ${STILL_WORKS}`;
}

function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

type Phase = "idle" | "starting" | "calibrating" | "running" | "error";

const MODE_HELP: Record<HandsFreeMode, string> = {
  look: "Look at ❤️ on the right for yes, or ✕ on the left for no, and hold your gaze for a moment.",
  tilt: "Tilt your head toward ❤️ on the right for yes, or toward ✕ on the left for no, and hold it briefly.",
};

export function HandsFree({ onAnswer, label }: { onAnswer: (liked: boolean) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<HandsFreeMode>("look");
  const [swap, setSwap] = useState(false);
  const [faceFound, setFaceFound] = useState(false);
  const [view, setView] = useState<{ side: Side | null; progress: number }>({ side: null, progress: 0 });
  const [calibLeft, setCalibLeft] = useState(2);
  const [announce, setAnnounce] = useState("");
  const reducedMotion = useReducedMotion();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const runRef = useRef(0); // bumps on every Start/Stop so stale async work bails out
  const phaseRef = useRef<Phase>("idle");
  const modeRef = useRef<HandsFreeMode>("look");
  const swapRef = useRef(false);
  const dwellRef = useRef<DwellState>(initialDwell());
  const zoneRef = useRef<Zone>("center");
  const onAnswerRef = useRef(onAnswer);
  const labelRef = useRef(label);
  const announceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    onAnswerRef.current = onAnswer;
    labelRef.current = label;
  }, [onAnswer, label]);

  const goto = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const resetDwell = () => {
    dwellRef.current = initialDwell();
    zoneRef.current = "center";
    setView({ side: null, progress: 0 });
  };

  const stopCamera = useCallback(() => {
    runRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  const answer = (liked: boolean) => {
    const text = `${liked ? "Liked" : "Skipped"} ${labelRef.current}`;
    setAnnounce(text);
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnounce(""), 2500);
    resetDwell();
    onAnswerRef.current(liked);
  };

  const fail = (message: string) => {
    stopCamera();
    setError(message);
    setFaceFound(false);
    goto("error");
  };

  const stop = () => {
    stopCamera();
    setFaceFound(false);
    resetDwell();
    goto("idle");
  };

  const start = async () => {
    stopCamera();
    const run = runRef.current;
    setError("");
    setFaceFound(false);
    resetDwell();
    goto("starting");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail(`This browser can't use the camera on this page. ${STILL_WORKS}`);
      return;
    }
    const modelLoad = loadLandmarker();
    modelLoad.catch(() => {}); // handled below; avoid an unhandled rejection if the camera fails first

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (e) {
      if (run === runRef.current) fail(cameraMessage(e));
      return;
    }
    if (run !== runRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    let landmarker: Landmarker;
    try {
      const video = videoRef.current;
      if (!video) throw new Error("no video element");
      video.srcObject = stream;
      await video.play();
      landmarker = await withTimeout(modelLoad, LOAD_TIMEOUT_MS);
    } catch {
      if (run === runRef.current)
        fail(`Face tracking couldn't load. Check your internet connection and press Start again. ${STILL_WORKS}`);
      return;
    }
    if (run !== runRef.current) return;

    const calib = { start: performance.now(), gaze: [] as number[], tilt: [] as number[] };
    const base = { gaze: 0, tilt: 0 };
    let lastVideoTime = -1;
    let lastFace: boolean | null = null;
    let lastCalibLeft = -1;
    let lastView = { side: null as Side | null, progress: 0 };
    setCalibLeft(2);
    goto("calibrating");

    const tick = () => {
      if (run !== runRef.current) return;
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const now = performance.now();

      let result: FaceResult;
      try {
        result = landmarker.detectForVideo(video, now);
      } catch {
        return; // a single bad frame should never break the session
      }
      const points = result.faceLandmarks?.[0];
      const shapes = result.faceBlendshapes?.[0]?.categories;
      const face = Boolean(points?.[33] && points?.[263] && shapes);
      if (face !== lastFace) {
        lastFace = face;
        setFaceFound(face);
      }
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
      const gaze = face ? gazeFromBlendshapes(shapes!) : 0;
      const tilt = face ? rollFromEyeCorners(points![33], points![263], aspect) : 0;

      if (phaseRef.current === "calibrating") {
        if (face) {
          calib.gaze.push(gaze);
          calib.tilt.push(tilt);
        }
        const left = Math.max(0, Math.ceil((CALIBRATION_MS - (now - calib.start)) / 1000));
        if (left !== lastCalibLeft) {
          lastCalibLeft = left;
          setCalibLeft(left);
        }
        // Wait for enough face samples so the baseline is real, not an empty-room guess.
        if (now - calib.start >= CALIBRATION_MS && calib.gaze.length >= 10) {
          base.gaze = median(calib.gaze);
          base.tilt = median(calib.tilt);
          dwellRef.current = initialDwell();
          zoneRef.current = "center";
          goto("running");
        }
        return;
      }

      const cfg = MODE_CONFIG[modeRef.current];
      const sign = swapRef.current ? -1 : 1;
      const value = sign * (modeRef.current === "look" ? gaze - base.gaze : tilt - base.tilt);
      const zone = face ? classifyZone(value, zoneRef.current, cfg.threshold, cfg.hysteresis) : null;
      zoneRef.current = zone ?? "center";
      const step = stepDwell(dwellRef.current, zone, now, cfg.dwellMs, REARM_MS);
      dwellRef.current = step.state;
      if (step.fired) {
        lastView = { side: null, progress: 0 };
        answer(step.fired === "right");
        return;
      }
      const progress = Math.round(step.progress * 50) / 50; // ~2% steps keeps re-renders cheap
      if (step.side !== lastView.side || progress !== lastView.progress) {
        lastView = { side: step.side, progress };
        setView(lastView);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const pickMode = (next: HandsFreeMode) => {
    modeRef.current = next;
    setMode(next);
    dwellRef.current = initialDwell();
    zoneRef.current = "center";
    setView({ side: null, progress: 0 });
  };

  const toggleSwap = () => {
    swapRef.current = !swapRef.current;
    setSwap(swapRef.current);
    resetDwell();
  };

  const active = phase === "starting" || phase === "calibrating" || phase === "running";
  const ring = (side: Side) => {
    const p = view.side === side ? view.progress : 0;
    return reducedMotion ? Math.floor(p * 4) / 4 : p; // stepped fill when motion is reduced
  };
  const segBtn = "min-h-14 flex-1 rounded-xl border-2 px-4 text-lg font-semibold";

  return (
    <div className="mb-4">
      <button
        type="button"
        aria-pressed={open}
        onClick={() => {
          if (open) stop();
          setOpen(!open);
        }}
        className={`min-h-14 w-full rounded-xl border-2 px-4 text-lg font-semibold ${open ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
      >
        Hands-free (camera): {open ? "on" : "off"}
      </button>

      {open && (
        <section aria-label="Hands-free answers" className="mt-3 space-y-3 rounded-xl border bg-card p-4">
          <p className="text-lg font-medium">Hands-free works on the interest cards.</p>

          <div className="flex gap-2" role="group" aria-label="Hands-free style">
            <button type="button" aria-pressed={mode === "look"} onClick={() => pickMode("look")}
              className={`${segBtn} ${mode === "look" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
              👀 Look
            </button>
            <button type="button" aria-pressed={mode === "tilt"} onClick={() => pickMode("tilt")}
              className={`${segBtn} ${mode === "tilt" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
              ↔️ Tilt head
            </button>
          </div>
          <p className="text-lg">{MODE_HELP[mode]}</p>

          <div className={active ? "flex items-center gap-3" : "hidden"}>
            <video
              ref={videoRef}
              muted
              playsInline
              aria-hidden="true"
              className="h-24 w-32 shrink-0 rounded-lg bg-muted object-cover -scale-x-100"
            />
            <p className="text-lg font-medium" aria-live="polite">
              <span aria-hidden="true" className={`mr-2 inline-block size-4 rounded-full align-middle ${faceFound ? "bg-green-700" : "bg-amber-500"}`} />
              {phase === "starting" && "Starting the camera…"}
              {phase === "calibrating" && (faceFound ? `Look at the middle of the screen… ${calibLeft}` : "Looking for your face — sit facing the screen.")}
              {phase === "running" && (faceFound ? "Face found. Ready." : "I can't see your face — sit facing the screen.")}
            </p>
          </div>

          {phase === "error" && (
            <p role="alert" className="rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-lg">{error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {active ? (
              <button type="button" onClick={stop} className="min-h-14 rounded-xl border-2 border-border bg-background px-6 text-lg font-semibold">
                Stop hands-free
              </button>
            ) : (
              <button type="button" onClick={start} className="min-h-14 rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground">
                {phase === "error" ? "Try again" : "Start hands-free"}
              </button>
            )}
            {phase === "running" && (
              <button type="button" aria-pressed={swap} onClick={toggleSwap} className="min-h-14 rounded-xl border-2 border-border bg-background px-4 text-lg">
                Swap sides
              </button>
            )}
          </div>

          <p className="text-base text-muted-foreground">Your camera stays on this device — nothing is recorded or sent.</p>
          <p aria-live="assertive" className="min-h-7 text-lg font-semibold">{announce && `✓ ${announce}`}</p>

          {phase === "running" && (
            <div className="flex justify-between gap-4 md:contents">
              <Target side="left" progress={ring("left")} reducedMotion={reducedMotion} label={label} onPress={() => answer(false)} />
              <Target side="right" progress={ring("right")} reducedMotion={reducedMotion} label={label} onPress={() => answer(true)} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const R = 52;
const C = 2 * Math.PI * R;

function Target({ side, progress, reducedMotion, label, onPress }: {
  side: Side;
  progress: number;
  reducedMotion: boolean;
  label: string;
  onPress: () => void;
}) {
  const yes = side === "right";
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={yes ? `Yes, I'd enjoy ${label}` : `No, skip ${label}`}
      className={`relative grid size-28 shrink-0 place-items-center rounded-full border-2 bg-background shadow-lg md:fixed md:top-1/2 md:z-40 md:-translate-y-1/2 ${yes ? "border-green-800 md:right-4" : "border-red-800 md:left-4"}`}
    >
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60" cy="60" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          className={`${yes ? "stroke-green-700" : "stroke-red-700"} ${reducedMotion ? "" : "transition-[stroke-dashoffset] duration-100"}`}
        />
      </svg>
      <span aria-hidden="true" className={`text-5xl ${yes ? "" : "font-bold text-red-800"}`}>{yes ? "❤️" : "✕"}</span>
    </button>
  );
}
