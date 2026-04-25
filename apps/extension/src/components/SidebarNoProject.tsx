import { env } from "@/env";
import { trpc } from "@/lib/trpc";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

function openDashboardProjects() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/app/projects` });
}

function openNewProject() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/app/projects/new` });
}

export function SidebarNoProject({ clerkOrgId }: { clerkOrgId: string | null }) {
  const projectsQuery = trpc.projects.list.useQuery(
    { orgId: clerkOrgId ?? "" },
    { enabled: Boolean(clerkOrgId), staleTime: 30_000 }
  );

  const items = projectsQuery.data?.items;
  const hasProjects = items !== undefined && items.length > 0;
  const isEmpty = items !== undefined && items.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-base">Create your first project</CardTitle>
            <CardDescription>
              Projects group annotations by site or staging environment. You'll need one before you
              can capture feedback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" onClick={openNewProject}>
              New project
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Default: projects exist (or we don't know yet) — prompt to pick one.
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Pick a project</CardTitle>
          <CardDescription>
            {hasProjects
              ? "Open the Remarks popup (extension icon) to select which project this tab's annotations belong to."
              : "Open the Remarks popup (extension icon) to select a project for this tab."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={openDashboardProjects}>
            Manage projects
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
