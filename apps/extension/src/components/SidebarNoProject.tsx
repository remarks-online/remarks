import { env } from "@/env";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

function openDashboardProjects() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/app/projects` });
}

export function SidebarNoProject() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Pick a project</CardTitle>
          <CardDescription>
            Open the Remarks popup (extension icon) to select which project this tab's annotations
            belong to.
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
