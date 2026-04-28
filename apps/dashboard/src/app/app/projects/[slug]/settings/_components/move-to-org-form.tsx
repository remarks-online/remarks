"use client";

import { trpc } from "@/lib/trpc-client";
import { useOrganizationList } from "@clerk/nextjs";
import type { ProjectResponse } from "@remarks/shared";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@remarks/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  project: ProjectResponse;
}

export function MoveToOrgForm({ project }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { isLoaded, userMemberships } = useOrganizationList({
    userMemberships: { infinite: false, pageSize: 100 },
  });
  const [targetClerkOrgId, setTargetClerkOrgId] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  const transferMutation = trpc.projects.transferToOrg.useMutation({
    onSuccess: async (moved) => {
      setFormError(null);
      await utils.projects.getBySlug.invalidate({ slug: project.slug });
      await utils.projects.list.invalidate();
      router.replace(`/app/projects/${moved.slug}/settings`);
      router.refresh();
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        const targetName = adminMemberships.find((m) => m.organization.id === targetClerkOrgId)
          ?.organization.name;
        setFormError(
          targetName
            ? `A project with the slug "${project.slug}" already exists in ${targetName}. Rename this project above first, then try again.`
            : error.message
        );
        return;
      }
      if (error.data?.code === "FORBIDDEN") {
        setFormError("You need org admin in the target organization to move a project into it.");
        return;
      }
      if (error.data?.code === "NOT_FOUND") {
        setFormError("Project not found. It may have been transferred or deleted.");
        return;
      }
      setFormError(error.message);
    },
  });

  // Caller can only transfer into orgs they admin (mirrors the API's authorization).
  const adminMemberships = userMemberships.data?.filter((m) => m.role === "org:admin") ?? [];

  const isAdmin = project.myRole === "admin";
  const isPending = transferMutation.isPending;
  const canSubmit = isAdmin && targetClerkOrgId !== "" && !isPending;

  function handleSubmit() {
    setFormError(null);
    if (!targetClerkOrgId) return;
    transferMutation.mutate({ projectId: project.id, targetClerkOrgId });
  }

  const targetName =
    adminMemberships.find((m) => m.organization.id === targetClerkOrgId)?.organization.name ??
    "the organization";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move to organization</CardTitle>
        <CardDescription>
          Moves this project and its annotations into an organization you administer. Members of{" "}
          {targetName} will gain editor access. This is one-way — the project cannot be moved back
          to personal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isAdmin ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Only the project creator can transfer it.
          </p>
        ) : null}
        {formError ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        {isAdmin && isLoaded && adminMemberships.length === 0 ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            You're not an admin of any organization yet. Create or join one before moving this
            project.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="target-org">Target organization</Label>
          <Select
            value={targetClerkOrgId}
            onValueChange={setTargetClerkOrgId}
            disabled={!isAdmin || !isLoaded || adminMemberships.length === 0 || isPending}
          >
            <SelectTrigger id="target-org" className="max-w-sm">
              <SelectValue placeholder="Select an organization…" />
            </SelectTrigger>
            <SelectContent>
              {adminMemberships.map((m) => (
                <SelectItem key={m.organization.id} value={m.organization.id}>
                  {m.organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end">
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {isPending ? "Moving…" : "Move project"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
