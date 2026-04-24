import { env } from "@/env";
import { getSelectedProjectId, setSelectedProjectId } from "@/lib/selected-project";
import { trpc } from "@/lib/trpc";
import { useOrganization } from "@clerk/chrome-extension";
import type { ProjectResponse } from "@remarks/shared";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@remarks/ui";
import { useEffect, useState } from "react";

export function ProjectPicker() {
  const { organization } = useOrganization();
  const clerkOrgId = organization?.id;

  const query = trpc.projects.list.useQuery(
    { orgId: clerkOrgId ?? "" },
    { enabled: Boolean(clerkOrgId) }
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reconcile stored selection against the fetched list once both land.
  // - If the stored id is still in the list, keep it.
  // - Otherwise, fall back to the first project and persist.
  useEffect(() => {
    if (!clerkOrgId) return;
    const items = query.data?.items;
    if (!items || items.length === 0) return;

    let cancelled = false;
    void (async () => {
      const stored = await getSelectedProjectId(clerkOrgId);
      if (cancelled) return;
      const storedStillValid = stored && items.some((p) => p.id === stored);
      if (storedStillValid) {
        setSelectedId(stored);
      } else {
        const first = items[0];
        if (!first) return;
        setSelectedId(first.id);
        await setSelectedProjectId(clerkOrgId, first.id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clerkOrgId, query.data]);

  async function onValueChange(nextId: string) {
    if (!clerkOrgId) return;
    setSelectedId(nextId);
    await setSelectedProjectId(clerkOrgId, nextId);
  }

  function openNewProjectTab() {
    void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/app/projects/new` });
  }

  if (!clerkOrgId) return null;

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Loading projects…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-destructive">Could not load projects.</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const items: ProjectResponse[] = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">No projects in this organization yet.</p>
        <Button size="sm" onClick={openNewProjectTab}>
          Create project in dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor="popup-project-select"
        className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        Project
      </Label>
      <Select {...(selectedId ? { value: selectedId } : {})} onValueChange={onValueChange}>
        <SelectTrigger id="popup-project-select">
          <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
          {items.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name} — {project.slug}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
