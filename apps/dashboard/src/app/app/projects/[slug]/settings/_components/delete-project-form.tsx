"use client";

import { trpc } from "@/lib/trpc-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@remarks/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  projectId: string;
  projectSlug: string;
}

export function DeleteProjectForm({ projectId, projectSlug }: Props) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      router.push("/app/projects");
      router.refresh();
    },
    onError: (error) => {
      if (error.data?.code === "FORBIDDEN") {
        setFormError("Only project admins can delete this project.");
        return;
      }
      setFormError(error.message);
    },
  });

  const canDelete = confirmation === projectSlug && !deleteMutation.isPending;

  function handleDelete() {
    setFormError(null);
    deleteMutation.mutate({ projectId });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Delete project</CardTitle>
        <CardDescription>
          Permanently deletes this project and all of its branches, annotations, screenshots, and
          API tokens. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="confirm-slug">
            Type <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{projectSlug}</code> to
            confirm
          </Label>
          <Input
            id="confirm-slug"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={deleteMutation.isPending}
            autoComplete="off"
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="destructive" disabled={!canDelete} onClick={handleDelete}>
            {deleteMutation.isPending ? "Deleting…" : "Delete project"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
