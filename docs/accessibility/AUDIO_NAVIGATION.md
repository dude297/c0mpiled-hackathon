# Audio guidance and local voice commands

This feature adds optional spoken guidance without changing main's onboarding, hands-free camera mode, planner, or consent rules. The only existing application file changed is `src/app/layout.tsx`, which mounts the toolbar and skip target. No deployment is included.

## Using the feature

Open **Accessibility & audio → Start guided navigation**. Device-local voices read the current onboarding question, helper text, choices, and keyboard instructions. Each new question is read automatically; turn that off with **Read each new question automatically** or use **Read current question and guidance** to repeat. The first interest question explains the name field without speaking its entered value. Review reads its heading rather than automatically speaking personal answers.

For interest cards, focus the card and press right arrow for Yes on the right, or left arrow for No on the left. Alternatively Tab to a Yes/No button and press Enter. The first keyboard stop is a skip link. Previous/next heading, read page/errors, repeat, pause/resume, stop, voice and speed controls remain available. Escape stops speech and closes the panel when focus is inside it. Screen-reader users can leave built-in speech off to avoid overlapping narration.

**Current spoken guidance** shows the exact generated narration. **Device voice started/finished playback** comes from browser utterance events, rather than merely queueing speech. Speaker audibility still needs human verification.

## Local speech setup

Voice commands use `getUserMedia` and `MediaRecorder`, not the browser vendor's SpeechRecognition service that failed with a network error. Four-second microphone clips go to the same-origin `/api/voice/transcribe` endpoint and a loopback-only Python Whisper worker. No audio/transcript files or request logs are written. The endpoint returns only allowlisted commands, not arbitrary transcripts. This is a localhost demo feature: nonlocal and cross-origin requests are rejected, and missing worker configuration fails closed.

One-time setup, with [uv](https://docs.astral.sh/uv/) installed:

```sh
uv venv --python 3.12 /private/tmp/daybridge-voice-venv
uv pip install --python /private/tmp/daybridge-voice-venv/bin/python -r scripts/voice-requirements.txt
/private/tmp/daybridge-voice-venv/bin/python -c "from faster_whisper.utils import download_model; download_model('tiny.en', output_dir='/private/tmp/daybridge-whisper-tiny-en')"
```

Run the worker alongside Next.js:

```sh
/private/tmp/daybridge-voice-venv/bin/python scripts/voice-server.py
npm run dev
```

The environment/model are under `/private/tmp` and may need recreation after OS cleanup. Set `DAYBRIDGE_VOICE_MODEL_DIR` for an alternative predownloaded model directory. The worker binds only `127.0.0.1:8765`; no public hosting, automatic startup or cloud fallback is configured. The pinned `av==16.0.1` avoids an incompatibility between faster-whisper 1.2.1 and av 19.

Click **Start voice commands**, allow microphone access, wait for **Listening locally**, then say one short command within four seconds. Wait during local processing; recording resumes after spoken guidance finishes. Supported commands: next/previous control, next/previous heading, read page, read errors, repeat, help, stop reading, stop listening, and yes/no on the focused interest card. There is no arbitrary click, dictation, approval, send, confirm or booking command. “Go back” moves focus backwards; it does not undo an answer.

Stop microphone and Escape release tracks and cancel pending requests. Route changes, hidden tabs, page exit, recording errors and three unrecognized clips also stop the session. A late microphone grant after cancellation is released without uploading audio. Speech playback is excluded from recording, though headphone and ambient-noise testing remain important. The command parser uses exact English phrases; recognition accuracy varies.

## Verification and limitations

Automated tests cover speech queue sequencing/cancellation, guidance deduplication and backwards steps, the command allowlist, local endpoint isolation/size limits, worker offline handling before microphone permission, clip transcription, late permission cancellation, suppression during speech, stop-listening and track cleanup.

Browser checks verified first-Tab skip, named controls, new-question narration, keyboard focus recovery, pause/resume, manual reading, automatic-reading opt-out, and actual device utterance start events. Main's mode picker is read with all available modes and descriptions. A real generated “next heading” audio file was transcribed by the local worker as `next heading`; this is not a live human microphone test. End-to-end microphone recognition and screen-reader/blind-participant acceptance remain unverified. Do not claim accessibility conformance or successful live microphone navigation based on unit tests.

Implementation references: [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).
