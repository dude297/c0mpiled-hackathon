import { afterEach, describe, expect, it, vi } from "vitest";
import { watchTrackingInterruptions, withTimeout } from "./HandsFree";

// Real event dispatch, synthetic page/track only: never opens a camera or browser.
function fixtures() {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const track = new EventTarget();
  const hidden = vi.fn();
  const ended = vi.fn();
  const cleanup = watchTrackingInterruptions(page as unknown as Document, [track as MediaStreamTrack], hidden, ended);
  return { page, track, hidden, ended, cleanup };
}

afterEach(() => vi.useRealTimers());

describe("tracking browser interruptions", () => {
  it("stops on hiding, never resumes automatically on becoming visible", () => {
    const { page, hidden, cleanup } = fixtures();
    page.dispatchEvent(new Event("visibilitychange"));
    expect(hidden).not.toHaveBeenCalled();
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(hidden).toHaveBeenCalledTimes(1);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(hidden).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("reports a disconnected/revoked camera track for recoverable failure", () => {
    const { track, ended, hidden, cleanup } = fixtures();
    track.dispatchEvent(new Event("ended"));
    expect(ended).toHaveBeenCalledTimes(1);
    expect(hidden).not.toHaveBeenCalled();
    cleanup();
  });

  it("removes old listeners so stopped sessions cannot stop a newer session", () => {
    const { page, track, ended, hidden, cleanup } = fixtures();
    cleanup();
    cleanup();
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    track.dispatchEvent(new Event("ended"));
    expect(hidden).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });

  it("watches visibility during pending startup before any camera track exists", () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    const cancel = vi.fn();
    const cleanup = watchTrackingInterruptions(page as unknown as Document, [], cancel, vi.fn());
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(cancel).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

describe("bounded video/model startup", () => {
  it("rejects a hung play promise and ignores its later resolution", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const play = new Promise<void>((done) => { resolve = done; });
    const pending = withTimeout(play, 10000);
    const rejected = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout for successful or failed startup", async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve("ready"), 10000)).resolves.toBe("ready");
    await expect(withTimeout(Promise.reject(new Error("blocked")), 10000)).rejects.toThrow("blocked");
    expect(vi.getTimerCount()).toBe(0);
  });
});
