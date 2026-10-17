import { parseVoiceCommand } from '@/features/audio-navigation/commands';

const WORKER = 'http://127.0.0.1:8765';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
function isLocal(request: Request) {
  const url = new URL(request.url);
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && (!request.headers.get('origin') || request.headers.get('origin') === url.origin);
}
export async function GET(request: Request) {
  if (!isLocal(request)) return json({ error: 'Local speech is available only on localhost.' }, 403);
  try {
    const response = await fetch(`${WORKER}/health`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    if (!response.ok) throw new Error('unavailable');
    return json({ ready: true, processing: 'local' });
  } catch { return json({ ready: false, error: 'Local speech service is offline. Start scripts/voice-server.py.' }, 503); }
}
export async function POST(request: Request) {
  if (!isLocal(request)) return json({ error: 'Local speech is available only on localhost.' }, 403);
  const length = Number(request.headers.get('content-length'));
  if (length > 2_000_000) return json({ error: 'Recording is too large.' }, 413);
  if (!/^(audio\/(webm|ogg|mp4|wav|mpeg)|video\/webm)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'Unsupported audio format.' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'No audio received.' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); return json({ error: 'Recording is too large.' }, 413); }
      chunks.push(result.value);
    }
    if (!size) return json({ error: 'No audio received.' }, 400);
    const audio = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
    const response = await fetch(`${WORKER}/transcribe`, { method: 'POST', body: audio,
      headers: { 'Content-Type': request.headers.get('content-type')! }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return json({ error: 'Local speech could not process this recording. Try again.' }, response.status === 429 ? 429 : 502);
    const data = await response.json();
    // Return only allowlisted commands; arbitrary microphone transcripts never reach the UI.
    return json({ command: typeof data.text === 'string' ? parseVoiceCommand(data.text) : null, processing: 'local' });
  } catch { return json({ error: 'Local speech service is unavailable. Start scripts/voice-server.py, then try again.' }, 503); }
}
