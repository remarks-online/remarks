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

const PERSONAL_VALUE = "__personal__";

export function ProjectPicker() {
  const { organization } = useOrganization();
  const clerkOrgId = organization?.id;

  const query = trpc.projects.list.useQuery(
    { orgId: clerkOrgId ?? "" },
    { enabled: Boolean(clerkOrgId) }
  );

  // null means "Personal" (capture without sharing). Project id strings mean
  // team-share scope. The local string state tracks the Select's value, which
  // uses PERSONAL_VALUE for the personal sentinel since Select needs a string.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Hydrate stored selection on mount / org switch. With no org, the picker
  // is implicitly Personal-only; with an org, the stored id (if any) wins.
  useEffect(() => {
    if (!clerkOrgId) {
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const stored = await getSelectedProjectId(clerkOrgId);
      if (!cancelled) setSelectedId(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [clerkOrgId]);

  // Drop a stale selection if the stored project disappeared (org switch,
  // project deleted) — fall back to Personal rather than silently capturing
  // into the wrong scope.
  useEffect(() => {
    if (!clerkOrgId || !selectedId) return;
    const items = query.data?.items;
    if (!items) return;
    if (!items.some((p) => p.id === selectedId)) {
      setSelectedId(null);
      void setSelectedProjectId(clerkOrgId, null);
    }
  }, [clerkOrgId, selectedId, query.data]);

  async function onValueChange(next: string) {
    const nextId = next === PERSONAL_VALUE ? null : next;
    setSelectedId(nextId);
    if (clerkOrgId) {
      await setSelectedProjectId(clerkOrgId, nextId);
    }
  }

  function openNewProjectTab() {
    void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/app/projects/new` });
  }

  const items: ProjectResponse[] = query.data?.items ?? [];
  const showProjects = clerkOrgId !== undefined;
  const hasProjects = showProjects && items.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor="popup-project-select"
        className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        Capture to
      </Label>
      <Select value={selectedId ?? PERSONAL_VALUE} onValueChange={onValueChange}>
        <SelectTrigger id="popup-project-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERSONAL_VALUE}>Personal (private)</SelectItem>
          {items.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name} — {project.slug}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showProjects && !hasProjects && !query.isLoading ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={openNewProjectTab}>
          Create a project to share with a team
        </Button>
      ) : null}
      {query.isError ? (
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          Retry loading projects
        </Button>
      ) : null}
    </div>
  );
}
