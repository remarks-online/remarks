"use client";

import { capture } from "@/lib/analytics";
import { trpc } from "@/lib/trpc-client";
import { PROJECT_SLUG_REGEX, createProjectRequestSchema } from "@remarks/shared";
import { Button, Input, Label } from "@remarks/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface Props {
  orgId: string;
}

type FieldErrors = Partial<Record<"name" | "slug" | "gitRepoUrl" | "primaryBranch", string>>;

export function NewProjectForm({ orgId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [primaryBranch, setPrimaryBranch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      capture("project_created", { source: "form", projectId: project.id });
      router.push("/app/projects");
      router.refresh();
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        setFieldErrors({ slug: "Slug already exists in this organization" });
        setFormError(null);
        return;
      }
      setFieldErrors({});
      setFormError(error.message);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const candidate = {
      name: name.trim(),
      slug: slug.trim(),
      ...(gitRepoUrl.trim() ? { gitRepoUrl: gitRepoUrl.trim() } : {}),
      primaryBranch: primaryBranch.trim() || "main",
    };

    const parsed = createProjectRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const errs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "name" || key === "slug" || key === "gitRepoUrl" || key === "primaryBranch") {
          errs[key] = issue.message;
        }
      }
      setFieldErrors(errs);
      return;
    }

    setFieldErrors({});
    createMutation.mutate({ orgId, input: parsed.data });
  }

  const isPending = createMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-md border border-border p-6">
      {formError ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={isPending}
          placeholder="Acme Web"
        />
        {fieldErrors.name ? <p className="text-xs text-destructive">{fieldErrors.name}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
          pattern={PROJECT_SLUG_REGEX.source}
          disabled={isPending}
          placeholder="acme-web"
        />
        <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and dashes.</p>
        {fieldErrors.slug ? <p className="text-xs text-destructive">{fieldErrors.slug}</p> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gitRepoUrl">Git repo URL (optional)</Label>
        <Input
          id="gitRepoUrl"
          type="url"
          value={gitRepoUrl}
          onChange={(e) => setGitRepoUrl(e.target.value)}
          disabled={isPending}
          placeholder="https://github.com/acme/web"
        />
        {fieldErrors.gitRepoUrl ? (
          <p className="text-xs text-destructive">{fieldErrors.gitRepoUrl}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="primaryBranch">Primary branch</Label>
        <Input
          id="primaryBranch"
          value={primaryBranch}
          onChange={(e) => setPrimaryBranch(e.target.value)}
          disabled={isPending}
          placeholder="main"
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}
