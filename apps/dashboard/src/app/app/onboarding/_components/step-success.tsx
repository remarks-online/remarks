"use client";

import type { AnnotationResponse } from "@remarks/shared";
import { Button } from "@remarks/ui";
import { PartyPopper } from "lucide-react";
import Link from "next/link";

interface Props {
  annotation: AnnotationResponse | null;
}

export function StepSuccess({ annotation }: Props) {
  const preview = annotation?.commentText.slice(0, 80) ?? null;
  return (
    <div className="space-y-6 rounded-md border border-border p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <PartyPopper className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">You&apos;re all set</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The extension captures, the dashboard organizes, and your AI agent picks up tasks.
            Anything you capture stays private to you until you share it via a team project.
          </p>
          {preview ? (
            <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm italic">
              &ldquo;{preview}
              {annotation && annotation.commentText.length > 80 ? "…" : ""}&rdquo;
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button asChild variant="ghost">
          <Link href="/app/connect-agent">Connect an AI agent</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/projects">Create a team project</Link>
        </Button>
        <Button asChild>
          <Link href="/app/personal">View my annotations</Link>
        </Button>
      </div>
    </div>
  );
}
