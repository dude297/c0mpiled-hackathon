import { describe, expect, it, vi } from "vitest";
import { createSpeechController, speechChunks, type SpeechDriver } from "./speech";
function fixture() {
  const calls: { text: string; end: () => void; error: () => void }[] = [];
  const driver: SpeechDriver = { speak: (text, end, error) => { calls.push({ text, end, error }); }, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() };
  const report = vi.fn(); const controller = createSpeechController(driver, report);
  return { controller, driver, calls, report };
}
describe("audio navigation", () => {
  it("splits long page text into sequential utterances without losing words", () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    const chunks = speechChunks(text);
    expect(chunks.length).toBeGreaterThan(1); expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
    const f = fixture(); f.controller.read(text);
    expect(f.calls).toHaveLength(1);
    for (let i = 0; i < chunks.length; i++) { expect(f.calls[i].text).toBe(chunks[i]); f.calls[i].end(); }
    expect(f.report).toHaveBeenLastCalledWith("idle");
  });
  it("never resumes cancelled speech from late browser callbacks", () => {
    const f = fixture(); f.controller.read("long page ".repeat(100)); const old = f.calls[0];
    f.controller.stop(); old.end(); old.error();
    expect(f.calls).toHaveLength(1); expect(f.report).toHaveBeenLastCalledWith("idle");
  });
  it("new speech supersedes an old page without mixing their queues", () => {
    const f = fixture(); f.controller.read("old text ".repeat(100)); const old = f.calls[0];
    f.controller.read("new control"); old.end();
    expect(f.calls).toHaveLength(2); expect(f.calls[1].text).toBe("new control");
  });
  it("pauses/resumes current speech and repeats after completion", () => {
    const f = fixture(); f.controller.read("Read this"); f.controller.pause();
    expect(f.driver.pause).toHaveBeenCalledOnce(); expect(f.report).toHaveBeenLastCalledWith("paused");
    f.controller.resume(); expect(f.driver.resume).toHaveBeenCalledOnce();
    f.calls[0].end(); f.controller.repeat(); expect(f.calls[1].text).toBe("Read this");
  });
  it("recovers from a speech error with a fresh request", () => {
    const f = fixture(); f.controller.read("first"); f.calls[0].error();
    expect(f.report).toHaveBeenLastCalledWith("error");
    f.controller.read("retry"); expect(f.calls[1].text).toBe("retry");
  });
  it("empty text and idle pause/resume do not start audio", () => {
    const f = fixture(); f.controller.read("  "); f.controller.repeat(); f.controller.pause(); f.controller.resume();
    expect(f.calls).toEqual([]); expect(f.driver.pause).not.toHaveBeenCalled(); expect(f.driver.resume).not.toHaveBeenCalled();
  });
});
