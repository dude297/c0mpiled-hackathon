export type SpeechStatus = "idle" | "speaking" | "paused" | "error";
export interface SpeechDriver {
  speak(text: string, onEnd: () => void, onError: () => void): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

// Short utterances avoid long-page truncation in browser speech engines.
export function speechChunks(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let chunk = "";
  for (const word of words) {
    if (chunk && chunk.length + word.length + 1 > 240) { chunks.push(chunk); chunk = ""; }
    chunk += `${chunk ? " " : ""}${word}`;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function createSpeechController(driver: SpeechDriver, report: (status: SpeechStatus) => void) {
  let generation = 0;
  let active = false;
  let previous = "";
  function stop() {
    generation++; active = false; driver.cancel(); report("idle");
  }
  function read(text: string) {
    stop();
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    previous = text;
    active = true;
    const token = generation;
    report("speaking");
    function next(index: number) {
      if (token !== generation) return;
      if (index === chunks.length) { active = false; report("idle"); return; }
      const fail = () => {
        if (token !== generation) return;
        generation++; active = false; driver.cancel(); report("error");
      };
      try { driver.speak(chunks[index], () => next(index + 1), fail); } catch { fail(); }
    }
    next(0);
  }
  return {
    read, stop,
    repeat() { if (previous) read(previous); },
    pause() { if (active) { driver.pause(); report("paused"); } },
    resume() { if (active) { driver.resume(); report("speaking"); } },
  };
}
