import { parseVoiceCommand, type VoiceCommand } from './commands';

/** Microphone -> same-origin local Whisper proxy. No browser recognition service. */
export async function startLocalCommands(
  execute: (command: VoiceCommand) => void,
  report: (message: string, active: boolean) => void,
  speaking: () => boolean,
  signal?: AbortSignal,
  answerContext: () => string | null = () => null,
): Promise<() => void> {
  const health = await fetch('/api/voice/transcribe', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  const status = await health.json();
  if (!health.ok || !status.ready) throw new Error(status.error || 'Local speech service is offline.');
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable in this browser.');
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  if (signal?.aborted) { stream.getTracks().forEach((track) => track.stop()); throw new DOMException("Cancelled", "AbortError"); }
  let stopped = false;
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout>;
  let request: AbortController | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true; signal?.removeEventListener("abort", stop); clearTimeout(timer); request?.abort();
    if (recorder?.state === 'recording') recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    report('Microphone off.', false);
  };
  signal?.addEventListener("abort", stop, { once: true });
  let misses = 0;
  const next = () => {
    if (stopped) return;
    if (speaking()) { report('Waiting for spoken guidance to finish. Microphone commands remain enabled.', true); timer = setTimeout(next, 250); return; }
    const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
    const mimeType = formats.find((format) => MediaRecorder.isTypeSupported(format));
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    const question = answerContext();
    let discard = false;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { stop(); report('Microphone recording failed. Check browser microphone access and try again.', false); };
    recorder.onstop = async () => {
      if (stopped) return;
      if (discard || speaking()) { timer = setTimeout(next, 350); return; }
      const audio = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      if (audio.size > 2_000_000) { stop(); report('Recording was too large. Start again with a short command.', false); return; }
      report('Processing your command on this computer…', true);
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 30_000);
      try {
        const response = await fetch('/api/voice/transcribe', { method: 'POST', body: audio, headers: { 'Content-Type': audio.type }, signal: request.signal });
        const data = await response.json();
        if (stopped) return;
        if (!response.ok) throw new Error(data.error || 'Local transcription failed.');
        const command = typeof data.command === 'string' ? parseVoiceCommand(data.command) : null;
        if (command === 'stop listening') { stop(); return; }
        if ((command === 'yes' || command === 'no') && (!question || question !== answerContext())) {
          report('The question changed. Say your answer again for the current card.', true);
        }
        else if (command) { misses = 0; report(`Recognized: “${command}”.`, true); execute(command); }
        else { misses++; report('No command recognized. Wait for Listening, then say next or read page.', true); }
        if (misses >= 3) { stop(); report('No command recognized three times. Microphone off. Start again when ready.', false); return; }
        timer = setTimeout(next, 700);
      } catch (error) {
        if (!stopped) { stop(); report(error instanceof Error ? error.message : 'Local transcription failed. Try again.', false); }
      } finally { clearTimeout(timeout); }
    };
    recorder.start();
    report('Listening locally for 4 seconds. Say one command now.', true);
    timer = setTimeout(() => { discard = speaking(); if (recorder?.state === 'recording') recorder.stop(); }, 4000);
  };
  try { next(); } catch (error) { stop(); throw error; }
  return stop;
}
