"use client";

import type { AnnotationResponse } from "@remarks/shared";
import { Button } from "@remarks/ui";
import { PartyPopper } from "lucide-react";
import Link from "next/link";

interface Props {
  project: { id: string; slug: string; name: string };
  annotation: AnnotationResponse | null;
}

export function StepSuccess({ project, annotation }: Props) {
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
            Your first annotation is captured in <span className="font-medium">{project.name}</span>
            . Invite teammates from the org switcher to share annotations across the team.
          </p>
          {preview ? (
            <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm italic">
              &ldquo;{preview}
              {annotation && annotation.commentText.length > 80 ? "…" : ""}&rdquo;
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button asChild>
          <Link href={`/app/projects/${project.slug}`}>View in {project.name}</Link>
        </Button>
      </div>
    </div>
  );
}
