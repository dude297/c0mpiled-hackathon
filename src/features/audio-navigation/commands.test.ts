import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "./commands";
describe("voice command allowlist", () => {
  it("normalizes only exact navigation phrases", () => {
    expect(parseVoiceCommand(" Next control! ")).toBe("next");
    expect(parseVoiceCommand("Choose YES.")).toBe("yes");
    expect(parseVoiceCommand("stop listening")).toBe("stop listening");
  });
  it("rejects arbitrary text and consequential actions", () => {
    for (const text of ["approve", "book ride", "send invitation", "click confirm", "yes send it", "don't say yes", "my name is next", "constructor", "__proto__"])
      expect(parseVoiceCommand(text)).toBeNull();
  });
});
