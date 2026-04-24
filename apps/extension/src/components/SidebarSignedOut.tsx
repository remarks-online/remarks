import { env } from "@/env";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@remarks/ui";

function openSignIn() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/sign-in` });
}

export function SidebarSignedOut() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Sign in to Remarks</CardTitle>
          <CardDescription>
            Open the extension popup to sign in. Once signed into the dashboard, the sidebar will
            pick up your session automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button size="sm" onClick={openSignIn}>
            Open dashboard sign-in
          </Button>
          <p className="text-xs text-muted-foreground">
            Or click the Remarks icon in the Chrome toolbar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
