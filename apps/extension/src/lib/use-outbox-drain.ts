import type { AnnotationResponse } from "@remarks/shared";
import { useEffect, useRef } from "react";
import { listAll } from "./outbox-db";
import { DRAIN_INTERVAL_MS, type DrainOutcome, drainOutbox } from "./outbox-drain";
import { outboxStore } from "./outbox-store";

export interface OutboxDrainContext {
  apiUrl: string;
  token: string | null;
  clerkOrgId: string | null;
  onSuccess?: (annotation: AnnotationResponse) => void;
}

/**
 * Drain the outbox once and re-hydrate the UI projection. Used by the
 * use-outbox-drain hook on its interval/online triggers, and by the
 * sidebar compose-box handler right after an enqueue so the happy path
 * doesn't wait for the next 30s tick.
 */
export async function triggerOutboxDrain(ctx: OutboxDrainContext): Promise<void> {
  // Always hydrate first — covers the "submit made a fresh record but the
  // compose-box's snapshot doesn't have it yet" case plus any changes from
  // another tab.
  const initialItems = await listAll().catch(() => []);
  outboxStore.getState().hydrate(initialItems);

  if (!ctx.token) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  try {
    await drainOutbox({
      apiUrl: ctx.apiUrl,
      token: ctx.token,
      clerkOrgId: ctx.clerkOrgId,
      onOutcome: (outcome: DrainOutcome) => {
        if (outcome.kind === "ok") ctx.onSuccess?.(outcome.annotation);
      },
    });
  } catch (err) {
    // Unexpected drain-level failure (IDB crash, etc). Swallow so the hook
    // survives; records are left as-is and will be re-tried next tick.
    console.warn("[remarks] drainOutbox failed", err);
  }

  const finalItems = await listAll().catch(() => []);
  outboxStore.getState().hydrate(finalItems);
}

export type UseOutboxDrainArgs = OutboxDrainContext;

/**
 * Mount the drain loop on the sidebar. Triggers:
 *   1. One hydrate + drain on mount (picks up records from a prior session).
 *   2. A 30s interval while mounted (spec §6.7).
 *   3. A `window.online` listener so reconnects are near-instant.
 */
export function useOutboxDrain(args: UseOutboxDrainArgs): void {
  const latest = useRef<OutboxDrainContext>(args);
  latest.current = args;

  useEffect(() => {
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      await triggerOutboxDrain(latest.current);
    };

    void tick();

    const timer = setInterval(() => {
      void tick();
    }, DRAIN_INTERVAL_MS);
    const onlineHandler = () => {
      void tick();
    };
    window.addEventListener("online", onlineHandler);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", onlineHandler);
    };
  }, []);
}
