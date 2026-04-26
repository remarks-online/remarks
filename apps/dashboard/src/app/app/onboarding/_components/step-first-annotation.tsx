"use client";

import { capture } from "@/lib/analytics";
import { trpc } from "@/lib/trpc-client";
import type { AnnotationResponse } from "@remarks/shared";
import { Button } from "@remarks/ui";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

interface Props {
  project: { id: string; slug: string; name: string };
  onAnnotationCaptured: (annotation: AnnotationResponse) => void;
  onSkip: () => void;
}

// Polls the same procedure / cadence as the project detail page so we
// inherit task 1.18's behavior (5s interval, paused when tab is backgrounded).
// Limit=1 keeps the poll cheap.
export function StepFirstAnnotation({ project, onAnnotationCaptured, onSkip }: Props) {
  const advancedRef = useRef(false);

  const query = trpc.annotations.list.useQuery(
    { projectId: project.id, limit: 1 },
    {
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    }
  );

  const firstItem = query.data?.items[0];

  useEffect(() => {
    if (!firstItem || advancedRef.current) return;
    advancedRef.current = true;
    capture("onboarding_step_completed", { step: 3, projectId: project.id });
    onAnnotationCaptured(firstItem);
  }, [firstItem, onAnnotationCaptured, project.id]);

  return (
    <div className="space-y-6 rounded-md border border-border p-6">
      <div>
        <h2 className="text-lg font-semibold">
          Capture your first annotation in <span className="font-mono">{project.name}</span>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Open the page you want to annotate, click the Remarks icon, and pick a target:
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
              Waiting for your first annotation in this project…
            </span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" asChild onClick={onSkip}>
          <Link href={`/app/projects/${project.slug}`}>I&apos;ll come back to this later</Link>
        </Button>
      </div>
    </div>
  );
}
