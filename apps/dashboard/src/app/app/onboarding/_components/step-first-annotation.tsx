"use client";

import { capture } from "@/lib/analytics";
import { trpc } from "@/lib/trpc-client";
import type { AnnotationResponse } from "@remarks/shared";
import { Button } from "@remarks/ui";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

interface Props {
  onAnnotationCaptured: (annotation: AnnotationResponse) => void;
  onSkip: () => void;
}

// Polls the user's personal annotations every 5s. Limit=1 keeps the poll
// cheap; scope=personal restricts to URL-keyed rows so a project annotation
// captured before onboarding doesn't accidentally satisfy this step.
export function StepFirstAnnotation({ onAnnotationCaptured, onSkip }: Props) {
  const advancedRef = useRef(false);

  const query = trpc.annotations.listForUser.useQuery(
    { limit: 1, scope: "personal" },
    {
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    }
  );

  const firstItem = query.data?.items[0];

  useEffect(() => {
    if (!firstItem || advancedRef.current) return;
    advancedRef.current = true;
    capture("onboarding_step_completed", { step: 2 });
    onAnnotationCaptured(firstItem);
  }, [firstItem, onAnnotationCaptured]);

  return (
    <div className="space-y-6 rounded-md border border-border p-6">
      <div>
        <h2 className="text-lg font-semibold">Capture your first annotation</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Open any page you want to annotate, click the Remarks icon, and pick a target. Your first
          capture lands in your private space — no team setup needed.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>
            Press{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
              C
            </kbd>{" "}
            to enter element-pick mode and click any element.
          </li>
          <li>
            Press{" "}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
              R
            </kbd>{" "}
            to draw a rectangle around a region.
          </li>
          <li>Add a comment and submit — it lands here within a few seconds.</li>
        </ul>
      </div>

      <div
        aria-live="polite"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
      >
        {firstItem ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
            <span>Got it! Your first annotation is in.</span>
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">
              Waiting for your first personal annotation…
            </span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onSkip}>
          I'll come back to this later
        </Button>
      </div>
    </div>
  );
}
