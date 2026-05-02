import type { FastifyReply, FastifyRequest } from "fastify";

// Hand-rolled SSE channel — no plugin dep. Encodes `id` / `event` / `data`
// frames per the W3C EventSource spec, plus a 25 s keepalive comment so
// idle proxies (Fly's Edge layer, browser-side intermediaries) don't drop
// the connection.
export interface SseChannel {
  sendEvent(args: { id: string; event: string; data: unknown }): void;
  sendComment(text: string): void;
  // Closes the underlying response stream. Idempotent.
  close(): void;
  onClose(handler: () => void): void;
  // True after `close()` has run or the client disconnected.
  isClosed(): boolean;
}

export interface StartSseOptions {
  // Initial `retry: <ms>` hint sent to clients. Browsers honor this on
  // network-level errors (not 4xx/5xx HTTP responses).
  retryMs?: number;
  // Time between keepalive comments. Default 25 s.
  keepaliveMs?: number;
  // Hard cap on connection duration; on expiry the channel emits a `rotate`
  // event and closes so the client reconnects fresh (with Last-Event-ID).
  maxConnectionMs?: number;
}

const DEFAULT_RETRY_MS = 5_000;
const DEFAULT_KEEPALIVE_MS = 25_000;
const DEFAULT_MAX_CONNECTION_MS = 5 * 60 * 1000;

export function startSseResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  opts: StartSseOptions = {}
): SseChannel {
  const retryMs = opts.retryMs ?? DEFAULT_RETRY_MS;
  const keepaliveMs = opts.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
  const maxConnectionMs = opts.maxConnectionMs ?? DEFAULT_MAX_CONNECTION_MS;

  // @fastify/cors sets the Access-Control-* headers on the reply object during
  // its onRequest hook, so they're already present by the time the route
  // handler runs. Snapshot them before hijacking — once we go raw, the cors
  // plugin's onSend hook can't reach the response, so cross-origin SSE
  // consumers (the dashboard at a different origin from the API) would see
  // their connection blocked at the browser security layer.
  const corsHeaders: Record<string, string | number | string[]> = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (lower.startsWith("access-control-") || lower === "vary") {
      corsHeaders[name] = value;
    }
  }

  // Tell Fastify we're taking over the response — otherwise its serializer
  // tries to JSON.stringify whatever the handler returns.
  reply.hijack();

  const res = reply.raw;
  res.writeHead(200, {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable Nginx-style buffering on any reverse proxy that honors it.
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: ${retryMs}\n\n`);
  res.write(": connected\n\n");

  const closeHandlers: Array<() => void> = [];
  let closed = false;

  const keepalive = setInterval(() => {
    if (closed) return;
    try {
      res.write(": keepalive\n\n");
    } catch {
      close();
    }
  }, keepaliveMs);
  // Don't keep the event loop alive just for keepalive pings.
  keepalive.unref?.();

  const rotate = setTimeout(() => {
    if (closed) return;
    try {
      // Plain comment + an event hint so the client sees a clean rotation.
      // No `id:` so EventSource keeps the last received id for reconnect.
      res.write("event: rotate\ndata: {}\n\n");
    } catch {
      // fall through to close()
    }
    close();
  }, maxConnectionMs);
  rotate.unref?.();

  function sendEvent(args: { id: string; event: string; data: unknown }): void {
    if (closed) return;
    try {
      const body = typeof args.data === "string" ? args.data : JSON.stringify(args.data);
      res.write(`id: ${args.id}\nevent: ${args.event}\ndata: ${body}\n\n`);
    } catch {
      close();
    }
  }

  function sendComment(text: string): void {
    if (closed) return;
    try {
      res.write(`: ${text}\n\n`);
    } catch {
      close();
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    clearTimeout(rotate);
    try {
      res.end();
    } catch {
      // already torn down
    }
    for (const h of closeHandlers) {
      try {
        h();
      } catch {
        // swallow — close handlers must be defensive
      }
    }
  }

  request.raw.on("close", close);
  request.raw.on("error", close);

  return {
    sendEvent,
    sendComment,
    close,
    onClose: (handler) => {
      if (closed) {
        // Run synchronously if we're already closed; matches addEventListener
        // ergonomics.
        try {
          handler();
        } catch {
          /* swallow */
        }
        return;
      }
      closeHandlers.push(handler);
    },
    isClosed: () => closed,
  };
}
