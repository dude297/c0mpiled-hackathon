import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
afterEach(() => vi.unstubAllGlobals());
const request = (body: BodyInit = 'test', origin = 'http://localhost:3000', type = 'audio/webm') => new Request('http://localhost:3000/api/voice/transcribe', { method:'POST', headers:{origin,'content-type':type}, body });
describe('local voice proxy', () => {
  it('fails closed for nonlocal callers and cross-origin uploads', async () => {
    expect((await GET(new Request('https://example.com/api/voice/transcribe'))).status).toBe(403);
    expect((await POST(request('test','https://evil.example'))).status).toBe(403);
  });
  it('returns an actionable offline status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const response=await GET(new Request('http://localhost:3000/api/voice/transcribe'));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ready:false});
  });
  it('rejects unsupported and oversized recordings before transcription', async () => {
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    expect((await POST(request('text','http://localhost:3000','text/plain'))).status).toBe(415);
    expect((await POST(request(new Uint8Array(2_000_001)))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns only allowlisted commands and never arbitrary transcripts', async () => {
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({text:'Next heading.'})).mockResolvedValueOnce(Response.json({text:'My private personal details'})); vi.stubGlobal('fetch',fetch);
    expect(await (await POST(request())).json()).toEqual({command:'next heading',processing:'local'});
    expect(await (await POST(request())).json()).toEqual({command:null,processing:'local'});
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8765/transcribe');
  });
});
