"use client";

import { capture } from "@/lib/analytics";
import { trpc } from "@/lib/trpc-client";
import { PROJECT_SLUG_REGEX, createProjectRequestSchema } from "@remarks/shared";
import { Button, Input, Label } from "@remarks/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface Props {
  // Null when no Clerk org is active — the only way to create a project is
  // personal-scope. When set, the form lets the user choose between personal
  // and the active org.
  orgId: string | null;
}

type Scope = "personal" | "org";

type FieldErrors = Partial<Record<"name" | "slug" | "gitRepoUrl" | "primaryBranch", string>>;

export function NewProjectForm({ orgId }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [primaryBranch, setPrimaryBranch] = useState("");
  const [scope, setScope] = useState<Scope>(orgId ? "org" : "personal");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      capture("project_created", {
        source: "form",
        projectId: project.id,
        scope: project.orgId ? "org" : "personal",
      });
      router.push("/app/projects");
      router.refresh();
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        setFieldErrors({
          slug:
            scope === "personal"
              ? "Slug already exists in your personal projects"
              : "Slug already exists in this organization",
        });
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
    const submitOrgId = scope === "org" && orgId ? orgId : undefined;
    createMutation.mutate({ orgId: submitOrgId, input: parsed.data });
  }

  const isPending = createMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-md border border-border p-6">
      {formError ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      {orgId ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Where should this project live?</legend>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 has-[input:checked]:border-primary">
              <input
                type="radio"
                name="scope"
                value="org"
                checked={scope === "org"}
                onChange={() => setScope("org")}
                disabled={isPending}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">In your active organization</span>
                <span className="block text-xs text-muted-foreground">
                  Visible to every member of the org. Choose this for team work.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2 has-[input:checked]:border-primary">
              <input
                type="radio"
                name="scope"
                value="personal"
                checked={scope === "personal"}
                onChange={() => setScope("personal")}
                disabled={isPending}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">Personal</span>
                <span className="block text-xs text-muted-foreground">
                  Only visible to you. Can be moved to an organization later.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
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
