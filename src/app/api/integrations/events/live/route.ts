import { discoverPublicEvents } from "@/lib/integrations/events";

// EventSource reconnects automatically. Source retrieval remains cached for
// five minutes per LiveWhale guidance; each connected client checks every minute.
export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let stop: (close?: boolean) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let busy = false;
      const timer: { id?: ReturnType<typeof setInterval> } = {};
      const onAbort = () => stop();
      stop = (close = true) => {
        if (closed) return;
        closed = true;
        if (timer.id) clearInterval(timer.id);
        request.signal.removeEventListener("abort", onAbort);
        if (close) controller.close();
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) { stop(); return; }
      const update = async () => {
        if (closed || busy) return;
        busy = true;
        try {
          const result = await discoverPublicEvents();
          if (!closed) controller.enqueue(encoder.encode(`event: events\ndata: ${JSON.stringify(result)}\n\n`));
        } catch {
          if (!closed) controller.enqueue(encoder.encode('event: unavailable\ndata: {}\n\n'));
        } finally { busy = false; }
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      timer.id = setInterval(() => { void update(); }, 60_000);
      void update();
    },
    cancel() { stop(false); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
