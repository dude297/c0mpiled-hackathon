export type VoiceCommand = "next" | "previous" | "next heading" | "previous heading" | "read page" | "read errors" | "repeat" | "stop reading" | "stop listening" | "help" | "yes" | "no";
const commands: Record<string, VoiceCommand> = {
  next: "next", "next control": "next", previous: "previous", "go back": "previous",
  "previous control": "previous", "next heading": "next heading", "previous heading": "previous heading",
  "read page": "read page", "read errors": "read errors", repeat: "repeat", "stop reading": "stop reading",
  "stop listening": "stop listening", help: "help", "voice help": "help", yes: "yes", "choose yes": "yes", no: "no", "choose no": "no",
};
export function parseVoiceCommand(text: string): VoiceCommand | null {
  const phrase = text.toLowerCase().trim().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
  return Object.hasOwn(commands, phrase) ? commands[phrase] : null;
}
