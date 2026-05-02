"use client";

import { useAuth } from "@clerk/nextjs";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { type AnnotationStreamEvent, annotationStreamEventSchema } from "@remarks/shared";
import { useEffect, useRef, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
if (!API_BASE_URL) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be set");
}

export type AnnotationStreamStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface UseAnnotationStreamArgs {
  projectId: string | null;
  enabled?: boolean;
  onEvent: (event: AnnotationStreamEvent) => void;
  onTruncated?: () => void;
}

export interface UseAnnotationStreamResult {
  status: AnnotationStreamStatus;
}

export function useAnnotationStream({
  projectId,
  enabled = true,
  onEvent,
  onTruncated,
}: UseAnnotationStreamArgs): UseAnnotationStreamResult {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<AnnotationStreamStatus>("closed");

  const onEventRef = useRef(onEvent);
  const onTruncatedRef = useRef(onTruncated);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onTruncatedRef.current = onTruncated;
  }, [onTruncated]);

  useEffect(() => {
    if (!enabled || !projectId) {
      setStatus("closed");
      return;
    }

    const controller = new AbortController();
    setStatus("connecting");

    // The lib snapshots `headers` once at start. To rotate JWTs across
    // reconnects (Clerk tokens are ~60s; the server rotates the connection at
    // 5min), we provide a custom fetch that mints a fresh token on every
    // attempt and merges it into the request headers.
    const authedFetch: typeof fetch = async (input, init) => {
      const token = await getToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return window.fetch(input, { ...init, headers });
    };

    fetchEventSource(`${API_BASE_URL}/projects/${projectId}/events`, {
      signal: controller.signal,
      fetch: authedFetch,
      openWhenHidden: false,
      onopen: async (response) => {
        if (response.status === 401 || response.status === 403) {
          // Hard auth failure — don't retry. onerror will throw and reject.
          throw new Error(`SSE auth failed: ${response.status}`);
        }
        if (
          !response.ok ||
          !response.headers.get("content-type")?.startsWith("text/event-stream")
        ) {
          throw new Error(`SSE open failed: ${response.status}`);
        }
        setStatus("open");
      },
      onmessage: (msg) => {
        if (msg.event === "rotate") {
          // Server is closing this connection at the 5-min cap. The lib will
          // reconnect automatically with the stored Last-Event-ID. Surface as
          // "reconnecting" until onopen fires again.
          setStatus("reconnecting");
          return;
        }
        if (msg.event === "replay_truncated") {
          onTruncatedRef.current?.();
          return;
        }
        if (msg.event === "replay_error") {
          // Treat like a regular reconnect — onTruncated path also resyncs.
          onTruncatedRef.current?.();
          return;
        }
        if (!msg.data) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(msg.data);
        } catch {
          return;
        }
        const result = annotationStreamEventSchema.safeParse(parsed);
        if (!result.success) return;
        onEventRef.current(result.data);
      },
      onerror: (err) => {
        // Throwing rejects the outer promise and stops retrying. Auth failures
        // (thrown from onopen above) reach this branch — propagate.
        if (err instanceof Error && err.message.startsWith("SSE auth failed")) {
          setStatus("closed");
          throw err;
        }
        setStatus("reconnecting");
        // Returning undefined → lib uses its current retry interval (initially
        // the server's `retry: 5000` hint, then the backoff state).
      },
      onclose: () => {
        setStatus("closed");
      },
    }).catch(() => {
      // Final rejection path (auth failure, abort, etc.). Status was set above.
    });

    return () => {
      controller.abort();
    };
  }, [enabled, projectId, getToken]);

  return { status };
}
