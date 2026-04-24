import { env } from "@/env";
import { getSelectedProjectId, setSelectedProjectId } from "@/lib/selected-project";
import { trpc } from "@/lib/trpc";
import { useOrganization } from "@clerk/chrome-extension";
import type { ProjectResponse } from "@remarks/shared";
import { type ChangeEvent, useEffect, useState } from "react";

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

  async function onChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!clerkOrgId) return;
    const nextId = event.target.value;
    setSelectedId(nextId);
    await setSelectedProjectId(clerkOrgId, nextId);
  }

  function openNewProjectTab() {
    void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/app/projects/new` });
  }

  if (!clerkOrgId) return null;

  if (query.isLoading) {
    return (
      <div className="popup-picker">
        <p className="popup-hint">Loading projects…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="popup-picker">
        <p className="popup-error">Could not load projects.</p>
        <button type="button" className="popup-secondary" onClick={() => query.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const items: ProjectResponse[] = query.data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="popup-picker">
        <p className="popup-hint">No projects in this organization yet.</p>
        <button type="button" onClick={openNewProjectTab}>
          Create project in dashboard
        </button>
      </div>
    );
  }

  return (
    <label className="popup-picker">
      <span className="popup-picker-label">Project</span>
      <select value={selectedId ?? ""} onChange={onChange}>
        {items.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} — {project.slug}
          </option>
        ))}
      </select>
    </label>
  );
}
