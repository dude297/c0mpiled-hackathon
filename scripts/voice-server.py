#!/usr/bin/env python3
"""Local-only DayBridge speech worker. No audio/transcript files or request logs."""
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import onnxruntime
from faster_whisper import WhisperModel

onnxruntime.disable_telemetry_events()

MODEL_DIR = os.environ.get('DAYBRIDGE_VOICE_MODEL_DIR', '/private/tmp/daybridge-whisper-tiny-en')
model = WhisperModel(MODEL_DIR, device='cpu', compute_type='int8', local_files_only=True)
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.respond(200 if self.path == '/health' else 404, {'ready': self.path == '/health', 'processing': 'local'})

    def do_POST(self):
        if self.path != '/transcribe':
            self.respond(404, {'error': 'Not found'}); return
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        if not 0 < length <= 2_000_000:
            self.respond(413, {'error': 'Audio must be under 2 MB'}); return
        if not lock.acquire(blocking=False):
            self.respond(429, {'error': 'Speech worker busy. Try again.'}); return
        try:
            segments, _ = model.transcribe(io.BytesIO(self.rfile.read(length)), language='en',
                beam_size=3, vad_filter=True, condition_on_previous_text=False)
            text = ' '.join(segment.text for segment in segments).strip()
            self.respond(200, {'text': text[:500]})
        except Exception:
            self.respond(422, {'error': 'Audio could not be decoded. Try recording again.'})
        finally:
            lock.release()

print('DayBridge local speech ready on 127.0.0.1:8765', flush=True)
ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
