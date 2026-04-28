"use client";

import { trpc } from "@/lib/trpc-client";
import {
  PROJECT_SLUG_REGEX,
  type ProjectResponse,
  updateProjectRequestSchema,
} from "@remarks/shared";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@remarks/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface Props {
  // Null when the project is personal — invalidation queries the personal-scope
  // cache key (`{ slug }` without orgId).
  orgId: string | null;
  project: ProjectResponse;
}

type FieldErrors = Partial<Record<"name" | "slug" | "gitRepoUrl" | "primaryBranch", string>>;

export function EditProjectForm({ orgId, project }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);
  const [gitRepoUrl, setGitRepoUrl] = useState(project.gitRepoUrl ?? "");
  const [primaryBranch, setPrimaryBranch] = useState(project.primaryBranch);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const updateMutation = trpc.projects.update.useMutation({
    onSuccess: async (updated) => {
      setFormError(null);
      setSuccessMessage("Saved.");
      // Invalidate both old and new slug entries so the project detail / settings
      // pages re-fetch from the server on the next navigation. The cache key for
      // personal projects omits orgId; for org projects it includes the active orgId.
      const scopeKey = orgId !== null ? { orgId } : {};
      await utils.projects.getBySlug.invalidate({ ...scopeKey, slug: project.slug });
      await utils.projects.list.invalidate(scopeKey);
      if (updated.slug !== project.slug) {
        await utils.projects.getBySlug.invalidate({ ...scopeKey, slug: updated.slug });
        // `replace` (not `push`) so the back button doesn't return to a 404.
        router.replace(`/app/projects/${updated.slug}/settings`);
      }
      router.refresh();
    },
    onError: (error) => {
      setSuccessMessage(null);
      if (error.data?.code === "CONFLICT") {
        setFieldErrors({
          slug:
            orgId === null
              ? "Slug already exists in your personal projects"
              : "Slug already exists in this organization",
        });
        setFormError(null);
        return;
      }
      if (error.data?.code === "FORBIDDEN") {
        setFieldErrors({});
        setFormError("Only project admins can edit settings.");
        return;
      }
      setFieldErrors({});
      setFormError(error.message);
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const trimmedGitRepoUrl = gitRepoUrl.trim();
    const trimmedPrimaryBranch = primaryBranch.trim() || "main";

    // Build a partial body with only the fields that actually changed. An empty
    // gitRepoUrl input maps to `null` (clear) when the project currently has one;
    // if it's already null/empty, we omit the key entirely so the refine fires
    // when nothing else changed.
    const candidate: Record<string, unknown> = {};
    if (trimmedName !== project.name) candidate.name = trimmedName;
    if (trimmedSlug !== project.slug) candidate.slug = trimmedSlug;
    if (trimmedPrimaryBranch !== project.primaryBranch) {
      candidate.primaryBranch = trimmedPrimaryBranch;
    }
    if (trimmedGitRepoUrl === "" && project.gitRepoUrl !== null) {
      candidate.gitRepoUrl = null;
    } else if (trimmedGitRepoUrl !== "" && trimmedGitRepoUrl !== project.gitRepoUrl) {
      candidate.gitRepoUrl = trimmedGitRepoUrl;
    }

    const parsed = updateProjectRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const errs: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "name" || key === "slug" || key === "gitRepoUrl" || key === "primaryBranch") {
          errs[key] = issue.message;
        } else {
          // The "at least one field" refine has an empty path.
          setFormError(issue.message);
        }
      }
      setFieldErrors(errs);
      return;
    }

    setFieldErrors({});
    updateMutation.mutate({ projectId: project.id, input: parsed.data });
  }

  const isAdmin = project.myRole === "admin";
  const isPending = updateMutation.isPending;
  const isDisabled = isPending || !isAdmin;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {!isAdmin ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {project.myRole === null
                ? "You're not a member of this project. Ask a project admin to add you."
                : "Only project admins can edit settings."}
            </p>
          ) : null}
          {formError ? (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          {successMessage ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {successMessage}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isDisabled}
            />
            {fieldErrors.name ? (
              <p className="text-xs text-destructive">{fieldErrors.name}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern={PROJECT_SLUG_REGEX.source}
              disabled={isDisabled}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and dashes. Changing the slug changes the URL of this
              project.
            </p>
            {fieldErrors.slug ? (
              <p className="text-xs text-destructive">{fieldErrors.slug}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gitRepoUrl">Git repo URL (optional)</Label>
            <Input
              id="gitRepoUrl"
              type="url"
              value={gitRepoUrl}
              onChange={(e) => setGitRepoUrl(e.target.value)}
              disabled={isDisabled}
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
              disabled={isDisabled}
            />
            {fieldErrors.primaryBranch ? (
              <p className="text-xs text-destructive">{fieldErrors.primaryBranch}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="submit" disabled={isDisabled}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
