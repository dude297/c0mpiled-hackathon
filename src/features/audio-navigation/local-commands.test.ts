import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocalCommands } from './local-commands';
class Recorder {
  static isTypeSupported() { return true; }
  static instance: Recorder;
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((e: {data:Blob})=>void) | null = null;
  onstop: (()=>void) | null = null;
  onerror: (()=>void) | null = null;
  constructor() { Recorder.instance = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({data:new Blob(['audio'])}); this.onstop?.(); }
}
function fixture(command: string | null = 'next') {
  vi.useFakeTimers();
  const trackStop = vi.fn(); const stream = {getTracks:()=>[{stop:trackStop}]};
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  vi.stubGlobal('MediaRecorder',Recorder);
  const fetch = vi.fn().mockImplementation(async (_url, init) => init?.method==='POST'
    ? Response.json({command}) : Response.json({ready:true}));
  vi.stubGlobal('fetch',fetch);
  return {trackStop,getUserMedia,fetch,execute:vi.fn(),report:vi.fn(),stream};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('local microphone commands',()=>{
  it('checks worker availability before requesting microphone access',async()=>{
    const f=fixture(); f.fetch.mockResolvedValue(Response.json({ready:false,error:'Worker offline'},{status:503}));
    await expect(startLocalCommands(f.execute,f.report,()=>false)).rejects.toThrow('Worker offline');
    expect(f.getUserMedia).not.toHaveBeenCalled();
  });
  it('transcribes an audio clip and stops microphone tracks on cleanup',async()=>{
    const f=fixture(); const stop=await startLocalCommands(f.execute,f.report,()=>false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.execute).toHaveBeenCalledExactlyOnceWith('next');
    expect(f.fetch.mock.calls[1][1].body).toBeInstanceOf(Blob);
    stop(); await vi.advanceTimersByTimeAsync(5000);
    expect(f.trackStop).toHaveBeenCalledOnce(); expect(f.execute).toHaveBeenCalledOnce();
  });
  it('releases a late microphone permission grant after cancellation',async()=>{
    const f=fixture(); let grant!:(s:unknown)=>void;
    f.getUserMedia.mockImplementation(()=>new Promise(resolve=>{grant=resolve;}));
    const signal=new AbortController(); const pending=startLocalCommands(f.execute,f.report,()=>false,signal.signal);
    await vi.advanceTimersByTimeAsync(0); signal.abort(); grant(f.stream);
    await expect(pending).rejects.toThrow('Cancelled'); expect(f.trackStop).toHaveBeenCalledOnce();
    expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('does not record spoken guidance or accept non-allowlisted responses',async()=>{
    const f=fixture('approve booking'); let speaking=true;
    const stop=await startLocalCommands(f.execute,f.report,()=>speaking);
    expect(f.report).toHaveBeenLastCalledWith(expect.stringContaining('Waiting'),true);
    speaking=false; await vi.advanceTimersByTimeAsync(4250);
    expect(f.execute).not.toHaveBeenCalled(); stop();
  });
  it('stop listening releases the microphone without executing an app action',async()=>{
    const f=fixture('stop listening'); await startLocalCommands(f.execute,f.report,()=>false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.trackStop).toHaveBeenCalledOnce();
    expect(f.report).toHaveBeenLastCalledWith('Microphone off.',false);
  });
});
