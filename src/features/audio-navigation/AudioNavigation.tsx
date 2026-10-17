"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { createSpeechController, type SpeechStatus } from "./speech";
import { controlDescription, isReadable, readableText } from "./page-text";
import { type VoiceCommand } from "./commands";
import { startLocalCommands } from "./local-commands";
import { currentGuidance, createGuidanceAnnouncer } from "./guidance";
import { audioStyles } from "./styles";

function subscribeVoices(callback: () => void) {
  if (!("speechSynthesis" in window)) return () => {};
  window.speechSynthesis.addEventListener("voiceschanged", callback);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", callback);
}
function voiceSnapshot() {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return "unsupported";
  return JSON.stringify(window.speechSynthesis.getVoices().filter((voice) => voice.localService).map((voice) => ({ id: voice.voiceURI, name: voice.name, lang: voice.lang })));
}
const serverSnapshot = () => "loading";
type VoiceOption = { id: string; name: string; lang: string };

export function AudioNavigation() {
  const pathname = usePathname();
  const snapshot = useSyncExternalStore(subscribeVoices, voiceSnapshot, serverSnapshot);
  const voices: VoiceOption[] = snapshot.startsWith("[") ? JSON.parse(snapshot) : [];
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [stepGuidance, setStepGuidance] = useState(true);
  const [guidanceText, setGuidanceText] = useState("");
  const [focusSpeech, setFocusSpeech] = useState(false);
  const [voiceId, setVoiceId] = useState("");
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [playback, setPlayback] = useState("No playback yet.");
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const [lastCommand, setLastCommand] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("Microphone off.");
  const listeningGeneration = useRef(0);
  const stopListening = useRef<(() => void) | null>(null);
  const lastControl = useRef<HTMLElement | null>(null);
  const lastHeading = useRef<HTMLElement | null>(null);
  const settings = useRef({ voiceId: "", rate: 1 });
  const controller = useRef<ReturnType<typeof createSpeechController> | null>(null);
  const voice = voices.find((v) => v.id === voiceId) ?? voices.find((v) => v.lang.startsWith("en")) ?? voices[0];
  const ready = voices.length > 0;

  useEffect(() => {
    const track = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !event.target.closest("[data-audio-navigation]")) lastControl.current = event.target;
    };
    const stop = () => { listeningGeneration.current++; stopListening.current?.(); stopListening.current = null; };
    const hidden = () => { if (document.hidden) stop(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") stop(); };
    document.addEventListener("focusin", track);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("keydown", escape);
    window.addEventListener("pagehide", stop);
    return () => {
      stop(); lastControl.current = null;
      document.removeEventListener("focusin", track);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("pagehide", stop);
    };
  }, [pathname]);

  useEffect(() => {
    settings.current = { voiceId: voice?.id ?? "", rate };
  }, [voice?.id, rate]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    let playbackGeneration = 0;
    const speech = createSpeechController({
      speak(text, onEnd, onError) {
        const selected = synth.getVoices().find((v) => v.localService && v.voiceURI === settings.current.voiceId);
        if (!selected) { onError(); return; }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = selected; utterance.lang = selected.lang; utterance.rate = settings.current.rate;
        const generation = playbackGeneration;
        setPlayback("Waiting for the device voice to start.");
        utterance.onstart = () => { if (generation === playbackGeneration) setPlayback("Device voice started playback."); };
        utterance.onend = () => { if (generation === playbackGeneration) setPlayback("Device voice finished playback."); onEnd(); };
        utterance.onerror = () => { if (generation === playbackGeneration) setPlayback("Device voice reported a playback error."); onError(); };
        synth.resume(); // cancel() may leave the browser engine paused.
        synth.speak(utterance);
      },
      cancel: () => { playbackGeneration++; synth.cancel(); setPlayback("Speech stopped."); }, pause: () => synth.pause(), resume: () => synth.resume(),
    }, setStatus);
    controller.current = speech;
    const stopOnHidden = () => { if (document.hidden) speech.stop(); };
    const stopOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      speech.stop();
      if (menu.current?.contains(document.activeElement)) {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const stop = () => speech.stop();
    document.addEventListener("visibilitychange", stopOnHidden);
    document.addEventListener("keydown", stopOnEscape);
    window.addEventListener("pagehide", stop);
    return () => {
      speech.stop(); controller.current = null;
      document.removeEventListener("visibilitychange", stopOnHidden);
      document.removeEventListener("keydown", stopOnEscape);
      window.removeEventListener("pagehide", stop);
    };
  }, [pathname]);

  useEffect(() => {
    if (!enabled || !focusSpeech) return;
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const description = controlDescription(event.target);
      if (description && !(stepGuidance && event.target.matches("[data-step-focus]"))) controller.current?.read(description);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, [enabled, focusSpeech, stepGuidance]);

  useEffect(() => {
    if (!enabled || !stepGuidance) return;
    const announce = createGuidanceAnnouncer((text) => { setGuidanceText(text); controller.current?.read(text); });
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!document.hidden) announce(currentGuidance()); }, 180);
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !(mutation.target instanceof Element ? mutation.target : mutation.target.parentElement)?.closest('[data-audio-navigation]'))) update();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    update();
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [enabled, stepGuidance, pathname]);

  function readGuidance() {
    const guidance = currentGuidance();
    const text = guidance?.text ?? "No current question is available. Use Read page to hear this page.";
    setGuidanceText(text); controller.current?.read(text);
  }
  function goToContent() {
    setOpen(false);
    const target = document.querySelector<HTMLElement>('[data-step-focus]') ?? document.querySelector<HTMLElement>('main, [role="main"], h1')
      ?? document.getElementById("daybridge-content-start");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    }
    target.focus(); target.scrollIntoView({ block: "start" });
  }
  function startGuidance() {
    setEnabled(true); setFocusSpeech(true); setStepGuidance(true); setNotice("");
    goToContent();
    const firstField = document.querySelector<HTMLElement>('[data-step-focus]');
    firstField?.focus();
    controller.current?.read("Guided navigation on. Use Tab for the next control and Shift Tab to go back. Press Enter or Space to choose. Press Escape to stop speaking. " +
      (document.activeElement instanceof HTMLElement ? controlDescription(document.activeElement) : ""));
  }
  function readPage() {
    const root = document.querySelector("main, [role=main]") ?? document.body;
    const text = readableText(root);
    controller.current?.read(text || "No readable page content is available.");
  }
  function readErrors() {
    const text = Array.from(document.querySelectorAll('[role="alert"], [aria-invalid="true"]')).filter(isReadable)
      .map((element) => element.matches('[aria-invalid="true"]') ? controlDescription(element as HTMLElement) + ". Invalid entry." : readableText(element)).join(". ");
    controller.current?.read(text || "No marked errors on this page.");
  }
  function nextHeading(backwards = false) {
    const headings = Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter(isReadable);
    const current = lastHeading.current?.isConnected ? lastHeading.current : document.activeElement;
    const ordered = backwards ? [...headings].reverse() : headings;
    const next = ordered.find((heading) => current && (current.compareDocumentPosition(heading) &
      (backwards ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING))) ?? ordered[0];
    if (!next) { setNotice("No headings on this page."); return; }
    if (!next.hasAttribute("tabindex")) {
      next.setAttribute("tabindex", "-1");
      next.addEventListener("blur", () => next.removeAttribute("tabindex"), { once: true });
    }
    lastHeading.current = next;
    next.focus(); next.scrollIntoView({ block: "center" });
    if (enabled && !focusSpeech) controller.current?.read(next.textContent ?? "Heading");
  }
  function executeVoiceCommand(command: VoiceCommand) {
    setLastCommand(command);
    if (command === "read page") { readPage(); return; }
    if (command === "read errors") { readErrors(); return; }
    if (command === "repeat") { controller.current?.repeat(); return; }
    if (command === "stop reading") { controller.current?.stop(); return; }
    if (command === "next heading" || command === "previous heading") {
      nextHeading(command === "previous heading");
      if (document.activeElement?.matches("h1, h2, h3, h4, h5, h6")) controller.current?.read(document.activeElement.textContent ?? "Heading");
      return;
    }
    if (command === "help") {
      const help = "Say next or previous to move between controls. Say yes or no only for the focused interest card. Say next heading, previous heading, read page, read errors, repeat, stop reading, or stop listening. Other buttons require the keyboard.";
      setVoiceNotice(help); controller.current?.read(help); return;
    }
    if (command === "yes" || command === "no") {
      // Strictly limited to the onboarding interest card. Never activate approvals or arbitrary buttons.
      const group = lastControl.current?.closest<HTMLElement>('[data-step-focus][role="group"]');
      const button = group && Array.from(group.querySelectorAll<HTMLButtonElement>("button"))
        .find((el) => el.textContent?.trim().toLowerCase() === command && !el.disabled && isReadable(el));
      if (button) { button.click(); setVoiceNotice(`Chose ${command}.`); }
      else setVoiceNotice("Move to an interest card first. Voice commands cannot approve, send or book anything.");
      return;
    }
    if (command !== "next" && command !== "previous") return;
    const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]'))
      .filter((el) => el.tabIndex >= 0 && !el.closest('[data-audio-navigation]') && !el.matches(':disabled, [aria-disabled="true"]') && isReadable(el));
    const current = lastControl.current;
    const ordered = command === "previous" ? [...controls].reverse() : controls;
    const target = ordered.find((el) => !current || (current.compareDocumentPosition(el) &
      (command === "previous" ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING))) ?? ordered[0];
    if (target) {
      setOpen(false); target.focus(); target.scrollIntoView({ block: "center" });
      const description = controlDescription(target); setVoiceNotice(description || "Control focused.");
      if (description) controller.current?.read(description);
    } else setVoiceNotice("No available controls on this page.");
  }
  async function startVoiceCommands() {
    stopListening.current?.(); controller.current?.stop();
    const generation = ++listeningGeneration.current;
    setListening(true); setVoiceNotice("Checking local speech service, then requesting microphone access…");
    // Install cancellation before awaiting permissions: a late grant must not start recording.
    let cancelled = false;
    const pending = new AbortController();
    stopListening.current = () => { cancelled = true; pending.abort(); listeningGeneration.current++; setListening(false); setVoiceNotice("Microphone off."); };
    try {
      const stop = await startLocalCommands(
        (command) => { if (!cancelled && generation === listeningGeneration.current) executeVoiceCommand(command); },
        (message, active) => { if (!cancelled && generation === listeningGeneration.current) { setVoiceNotice(message); setListening(active); } },
        () => !!window.speechSynthesis?.speaking || !!window.speechSynthesis?.pending, pending.signal);
      if (cancelled || generation !== listeningGeneration.current) stop();
      else stopListening.current = stop;
    } catch (error) {
      if (cancelled || generation !== listeningGeneration.current) return;
      setListening(false);
      setVoiceNotice(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone access denied. Allow the microphone in browser site settings, then try again."
        : error instanceof Error ? error.message : "Local voice commands could not start.");
    }
  }
  function disable() { controller.current?.stop(); setEnabled(false); setFocusSpeech(false); }

  return (
    <aside aria-label="Accessibility and spoken guidance" data-audio-navigation className="db-audio-shell">
      <a className="db-audio-skip" href="#daybridge-content-start" onClick={(event) => { event.preventDefault(); goToContent(); }}>Skip to page content</a>
      <style>{audioStyles}</style>
      <div ref={menu} className="db-audio-menu">
      <button ref={toggle} type="button" className="db-audio-toggle" aria-expanded={open} aria-controls="db-audio-panel" onClick={() => setOpen(!open)}>Accessibility &amp; audio</button>
      <section id="db-audio-panel" hidden={!open} className="db-audio-panel" aria-label="Spoken guidance controls">
      <div className="db-audio-top">
        <strong>Audio navigation</strong>
        <button className="db-audio-button" onClick={goToContent}>Return to page</button>
        {enabled ? <button className="db-audio-button" onClick={disable}>Turn speech off</button> :
          <button className="db-audio-button" disabled={!ready} onClick={startGuidance}>Start guided navigation</button>}
      </div>
      <p className="db-audio-help">Using VoiceOver or another screen reader? Keep our speech off and use your usual commands. For built-in guidance, start above, then Tab to move and Enter or Space to choose. No microphone needed.</p>
      {snapshot === "unsupported" && <p role="status">This browser does not support speech. Keyboard navigation and your screen reader still work.</p>}
      {snapshot.startsWith("[") && !ready && <p role="status">No local voice is available yet. Install a device voice or use your screen reader; online voices are not used.</p>}
      <div className="db-audio-voice">
        <p id="db-voice-privacy" className="db-audio-help">Voice commands record short microphone clips and process them on this computer using the local speech service. Audio and transcripts are not saved. No browser-vendor speech service is used.</p>
        <button className="db-audio-button" aria-describedby="db-voice-privacy db-voice-help" disabled={listening} onClick={startVoiceCommands}>Start voice commands</button>
        <p id="db-voice-help" className="db-audio-help">Say “next”, “previous”, “next heading”, “read page”, or “help”. Say “yes” or “no” on an interest card. Say “stop listening” or press Escape to turn the microphone off. Wait for “Listening locally”, say one command within 4 seconds, then wait for it to be processed. Listening resumes after spoken guidance finishes.</p>
      </div>
      {enabled && <div className="db-audio-controls">
        <button className="db-audio-button" onClick={readGuidance}>Read current question and guidance</button>
        <label className="db-audio-setting"><input type="checkbox" checked={stepGuidance} onChange={(event) => { controller.current?.stop(); setStepGuidance(event.target.checked); }} /> Read each new question automatically</label>
        <button className="db-audio-button" onClick={readPage}>Read page</button>
        <button className="db-audio-button" onClick={() => controller.current?.repeat()}>Repeat</button>
        <button className="db-audio-button" disabled={status !== "speaking" && status !== "paused"} onClick={() => status === "paused" ? controller.current?.resume() : controller.current?.pause()}>{status === "paused" ? "Resume" : "Pause"}</button>
        <button className="db-audio-button" onClick={() => controller.current?.stop()}>Stop speech</button>
        <button className="db-audio-button" onClick={readErrors}>Read errors</button>
        <details className="db-audio-settings"><summary>Voice and reading settings</summary>
        <label className="db-audio-setting">Voice <select value={voice?.id ?? ""} onChange={(event) => { controller.current?.stop(); setVoiceId(event.target.value); }}>
          {voices.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.lang})</option>)}
        </select></label>
        <label className="db-audio-setting">Speed <select value={rate} onChange={(event) => { controller.current?.stop(); setRate(Number(event.target.value)); }}>
          <option value={0.8}>Slower</option><option value={1}>Normal</option><option value={1.2}>Faster</option>
        </select></label>
        <label className="db-audio-setting"><input type="checkbox" checked={focusSpeech} onChange={(event) => { controller.current?.stop(); setFocusSpeech(event.target.checked); }} /> Read controls as I move (entered values stay private)</label>
        </details>
      </div>}
      <div className="db-audio-bottom">
        <button className="db-audio-button" onClick={() => nextHeading(true)}>Previous heading</button>
        <button className="db-audio-button" onClick={() => nextHeading()}>Next heading</button>
        <button className="db-audio-button" onClick={() => { setOpen(false); toggle.current?.focus(); }}>Close audio controls</button>
        {enabled && <span role="status" aria-live="polite">{status === "error" ? "Speech failed. Try again or use your screen reader." : status === "speaking" ? "Speaking" : status === "paused" ? "Paused" : "Speech ready"}</span>}
        {enabled && <p>{playback}</p>}
        {guidanceText && <details><summary>Current spoken guidance</summary><p>{guidanceText}</p></details>}
        {notice && <span role="status">{notice}</span>}
      </div>
      </section>
      </div>
      <div className="db-audio-mic-status">
        {listening && <button className="db-audio-button" onClick={() => stopListening.current?.()}>Stop microphone</button>}
        <p role="status" aria-live="polite">{voiceNotice}</p>
        {lastCommand && <p>Last recognized command: “{lastCommand}”</p>}
      </div>
    </aside>
  );
}
