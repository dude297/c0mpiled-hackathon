// The tiny web page that runs inside the hands-free WebView: front camera → MediaPipe Face
// Landmarker (loaded at runtime from a pinned CDN, not an npm dependency) → eye gaze / head roll →
// the shared dwell logic (HANDSFREE_CORE_JS) → postMessage to React Native:
//   {type:'status', state, face?, progress?, error?, detail?}
//   {type:'ready', swapSides:boolean} (native replays the latest selected mode)
//   {type:'progress', side:'left'|'right'|null, value:0..1, signal:-1..1, reading, zone, mode}
//   {type:'answer', liked:boolean, mode}
// React Native talks back with injectJavaScript: window.__hf.setMode('look'|'tilt'), .recalibrate(), .stop().
// Nothing leaves the device: frames go from the camera to the on-device model and are never sent or saved.
import { HANDSFREE_CORE_JS, type Mode, type Zone } from './handsfree';

export const MEDIAPIPE_VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// An https origin makes the page a secure context, which getUserMedia requires on iOS and Android.
export const HANDSFREE_BASE_URL = 'https://daybridge.local/';

export type PageError = 'denied' | 'nocamera' | 'load';
export type PageMessage =
  | { type: 'ready'; swapSides: boolean }
  | { type: 'status'; state: 'starting' | 'loading' | 'calibrating' | 'tracking' | 'stopped'; face?: boolean; progress?: number; detail?: string }
  | { type: 'status'; state: 'error'; error: PageError; detail?: string }
  | { type: 'progress'; side: 'left' | 'right' | null; value: number; signal: number; reading: number; zone: Zone; mode: Mode }
  | { type: 'answer'; liked: boolean; mode: Mode };

// Narrow an untrusted postMessage string to a PageMessage (or null).
export function parsePageMessage(data: string): PageMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (o.type === 'ready' && typeof o.swapSides === 'boolean') return { type: 'ready', swapSides: o.swapSides };
  if (o.type === 'answer' && typeof o.liked === 'boolean' && (o.mode === 'look' || o.mode === 'tilt'))
    return { type: 'answer', liked: o.liked, mode: o.mode };
  if (o.type === 'progress' && (o.side === 'left' || o.side === 'right' || o.side === null)
      && typeof o.value === 'number' && Number.isFinite(o.value)
      && typeof o.signal === 'number' && Number.isFinite(o.signal)
      && typeof o.reading === 'number' && Number.isFinite(o.reading)
      && (o.zone === 'left' || o.zone === 'center' || o.zone === 'right') && (o.mode === 'look' || o.mode === 'tilt'))
    return { type: 'progress', side: o.side, value: Math.min(1, Math.max(0, o.value)),
      signal: Math.min(1, Math.max(-1, o.signal)), reading: o.reading, zone: o.zone, mode: o.mode };
  if (o.type === 'status') {
    if (o.state === 'error') {
      const error = o.error === 'denied' || o.error === 'nocamera' ? o.error : 'load';
      return { type: 'status', state: 'error', error, detail: typeof o.detail === 'string' ? o.detail : undefined };
    }
    if (o.state === 'starting' || o.state === 'loading' || o.state === 'calibrating' || o.state === 'tracking' || o.state === 'stopped')
      return {
        type: 'status',
        state: o.state,
        face: typeof o.face === 'boolean' ? o.face : undefined,
        progress: typeof o.progress === 'number' ? o.progress : undefined,
        detail: typeof o.detail === 'string' ? o.detail.slice(0, 120) : undefined,
      };
  }
  return null;
}

// One command path for taps and the ready handshake; tested against the actual injected page.
export function handsFreeModeScript(mode: Mode): string {
  return `window.__hf && window.__hf.setMode(${JSON.stringify(mode)}); true;`;
}

export function buildHandsFreeHtml(mode: Mode): string {
  const app = String.raw`
(function () {
  var CDN = ${JSON.stringify(CDN)};
  var MODEL = ${JSON.stringify(MODEL)};
  var mode = ${JSON.stringify(mode)};
  var swapSides = false;
  var swapKey = 'daybridge.handsfree.swapSides';
  try { window.localStorage.removeItem(swapKey); } catch (e) {} // Swap sides always starts OFF each session
  var running = true, stream = null, landmarker = null, lastVideoTime = -1, errors = 0;
  var vision = null, files = null, delegate = null, switching = false;
  var phase = 'starting', lastFace = null;
  var baseline = 0, smoothedLook = 0;
  var calib = null;
  var zone = 'center', dwell = initialDwell();
  var signal = 0, reading = 0;
  var sent = {};
  var video = document.getElementById('v');

  function post(m) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {}
  }
  function fail(error, detail) {
    if (phase === 'error') return;
    phase = 'error';
    stop(true);
    post({ type: 'status', state: 'error', error: error, detail: detail ? String(detail).slice(0, 200) : undefined });
  }
  function stop(silent) {
    running = false;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (landmarker) { try { landmarker.close(); } catch (e) {} landmarker = null; }
    if (!silent) post({ type: 'status', state: 'stopped' });
  }
  function sendProgress(side, value, force) {
    if (!force && side === sent.side && mode === sent.mode && zone === sent.zone
        && Math.abs(value - sent.value) < 0.03 && Math.abs(signal - sent.signal) < 0.03
        && Math.abs(reading - sent.reading) < (mode === 'look' ? 0.001 : 0.1)) return;
    sent = { type: 'progress', side: side, value: value, signal: signal, reading: reading, zone: zone, mode: mode };
    post(sent);
  }
  function resetDwell() { zone = 'center'; signal = 0; reading = 0; smoothedLook = 0; dwell = rearmDwell(); sendProgress(null, 0, true); }
  function rearm() {
    zone = 'center'; signal = 0; reading = 0; smoothedLook = 0;
    dwell = phase === 'tracking' ? rearmDwell() : initialDwell();
    sendProgress(null, 0, true);
  }
  function startCalib() {
    window.__hfLive = true;
    baseline = 0;
    calib = { values: [], ms: 0, last: null, sentAt: 0 };
    phase = 'calibrating';
    resetDwell();
    post({ type: 'status', state: 'calibrating', face: !!lastFace, progress: 0 });
  }
  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(s.length / 2);
    return !s.length ? 0 : s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timed out')); }, ms); })]);
  }

  window.__hf = {
    setMode: function (m) {
      if ((m !== 'look' && m !== 'tilt') || m === mode) return;
      mode = m;
      // Switch sources immediately; never reuse the other mode's baseline or EMA history.
      if (running && (phase === 'tracking' || phase === 'calibrating')) startCalib();
      else rearm();
    },
    setSwapSides: function (swap) {
      if (typeof swap !== 'boolean' || swap === swapSides) return;
      swapSides = swap;
      try { window.localStorage.setItem(swapKey, String(swap)); } catch (e) {}
      rearm();
    },
    recalibrate: function () { if (running && landmarker) startCalib(); },
    stop: function () { stop(false); }
  };
  post({ type: 'ready', swapSides: swapSides });

  function handle(res, now) {
    var face = !!(res && res.faceLandmarks && res.faceLandmarks.length);
    if (face !== lastFace) {
      lastFace = face;
      post({ type: 'status', state: phase, face: face, progress: calib && phase === 'calibrating' ? Math.min(1, calib.ms / TUNING.calibrateMs) : undefined });
    }
    if (!face) {
      if (calib) calib.last = null;
      if (phase === 'tracking') {
        var r0 = stepDwell(dwell, null, now, TUNING[mode].dwellMs, TUNING.rearmMs);
        dwell = r0.state; zone = 'center'; signal = 0; reading = 0; smoothedLook = 0;
        sendProgress(null, 0);
      }
      return;
    }
    var lm = res.faceLandmarks[0];
    var bs = {};
    var cats = res.faceBlendshapes && res.faceBlendshapes[0] ? res.faceBlendshapes[0].categories : [];
    for (var i = 0; i < cats.length; i++) bs[cats[i].categoryName] = cats[i].score;
    var gaze = gazeFromBlendshapes(bs);
    var aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1;
    var raw = mode === 'look' ? gaze : tiltFromLandmarks(lm[33], lm[263], aspect);

    if (phase === 'calibrating') {
      calib.values.push(raw);
      if (calib.last !== null) calib.ms += Math.min(now - calib.last, 100);
      calib.last = now;
      if (calib.ms >= TUNING.calibrateMs) {
        baseline = median(calib.values);
        calib = null;
        phase = 'tracking';
        resetDwell();
        post({ type: 'status', state: 'tracking', face: true });
      } else if (now - calib.sentAt > 200) {
        calib.sentAt = now;
        post({ type: 'status', state: 'calibrating', face: true, progress: Math.min(1, calib.ms / TUNING.calibrateMs) });
      }
      return;
    }
    if (phase !== 'tracking') return;
    var cfg = TUNING[mode];
    var v = raw - baseline;
    if (mode === 'look') {
      smoothedLook = smoothLook(lookFromSignals(gaze, baseline), smoothedLook);
      v = smoothedLook;
    }
    if (swapSides) v = -v;
    reading = v;
    signal = clamp(v / cfg.threshold, -1, 1);
    zone = classify(v, zone, cfg.threshold, cfg.hysteresis);
    var dwellZone = zone;
    // EMA can linger in the middle after the eyes have already left it. Do not count that
    // filter lag toward the center gate: both current eyes and the smoothed zone must center.
    if (mode === 'look' && dwell.needsCenter && Math.abs(raw - baseline) > cfg.threshold - cfg.hysteresis) {
      dwellZone = (swapSides ? baseline - raw : raw - baseline) > 0 ? 'right' : 'left';
    }
    var r = stepDwell(dwell, dwellZone, now, cfg.dwellMs, TUNING.rearmMs);
    dwell = r.state;
    if (r.fired) {
      sendProgress(r.fired, 1, true);
      post({ type: 'answer', liked: r.fired === 'right', mode: mode });
      sendProgress(null, 0, true);
      return;
    }
    sendProgress(r.side, r.progress);
  }

  function make(d, ms) {
    return withTimeout(vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: d },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true
    }), ms || 14000).then(function (l) { delegate = d; return l; });
  }
  // GPU made a landmarker but it keeps throwing on frames (WebGL in WKWebView can do this):
  // swap to CPU once instead of giving up. The loop pauses until the new one is ready.
  function fallBackToCpu(err) {
    switching = true;
    try { landmarker.close(); } catch (e) {}
    landmarker = null;
    make('CPU').then(function (l) {
      if (!running) { try { l.close(); } catch (e) {} return; }
      landmarker = l; errors = 0; switching = false;
      requestAnimationFrame(loop);
    }, function (e) { fail('load', (e && e.message) || err); });
  }

  function loop() {
    if (!running || switching) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      var now = performance.now();
      var res = null;
      try { res = landmarker.detectForVideo(video, now); errors = 0; }
      catch (e) {
        if (++errors > 30) {
          if (delegate === 'GPU') return fallBackToCpu(e);
          return fail('load', e);
        }
      }
      handle(res, now);
    }
    requestAnimationFrame(loop);
  }

  async function start() {
    post({ type: 'status', state: 'starting', detail: 'Asking for the camera…' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail('nocamera', 'getUserMedia unavailable');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      var n = e && e.name;
      return fail(n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError' ? 'denied' : 'nocamera', n || e);
    }
    if (!running) return stop(true);
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}
    phase = 'loading';
    post({ type: 'status', state: 'loading', detail: 'Camera on. Downloading the face model…' });
    try {
      vision = await withTimeout(import(CDN + '/vision_bundle.mjs'), 14000);
      post({ type: 'status', state: 'loading', detail: 'Loading the face model files…' });
      files = await withTimeout(vision.FilesetResolver.forVisionTasks(CDN + '/wasm'), 14000);
      post({ type: 'status', state: 'loading', detail: 'Starting the face model…' });
      // GPU (WebGL) can fail or hang in iOS WebViews: give it a short try, then use the CPU.
      try { landmarker = await make('GPU', 7000); } catch (e) {
        post({ type: 'status', state: 'loading', detail: 'Using the slower CPU mode…' });
        landmarker = await make('CPU', 14000);
      }
    } catch (e) {
      return fail('load', e && e.message ? e.message : e);
    }
    if (!running) return stop(true);
    startCalib();
    requestAnimationFrame(loop);
  }

  window.addEventListener('error', function (e) { if (phase === 'starting' || phase === 'loading') fail('load', e.message); });
  start();
})();`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;background:#1a1a1a;overflow:hidden}
video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
</style></head>
<body><video id="v" autoplay muted playsinline></video>
<script>
(function () {
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  post({ type: 'status', state: 'starting', detail: 'Hands-free page loaded…' });
  window.addEventListener('error', function (e) { if (!window.__hf) post({ type: 'status', state: 'error', error: 'load', detail: 'Script error: ' + (e && e.message) }); });
  window.addEventListener('unhandledrejection', function (e) { if (!window.__hfLive) post({ type: 'status', state: 'error', error: 'load', detail: 'Error: ' + String(e && e.reason && (e.reason.message || e.reason)).slice(0, 150) }); });
})();
</script>
<script>${HANDSFREE_CORE_JS}</script>
<script>${app}</script>
</body></html>`;
}
