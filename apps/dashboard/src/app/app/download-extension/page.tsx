import { env } from "@/env";
import { auth } from "@clerk/nextjs/server";
import { type ExtensionRelease, extensionReleaseSchema } from "@remarks/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@remarks/ui";
import { DownloadButton } from "./_components/download-button";

// /app/* is force-dynamic via the parent layout, so this fetch runs on every
// visit and the presigned URL is always freshly minted.
async function fetchLatestRelease(): Promise<ExtensionRelease | null> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return null;

  const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/extension/latest`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch extension release: ${res.status}`);
  }
  return extensionReleaseSchema.parse(await res.json());
}

export default async function DownloadExtensionPage() {
  const release = await fetchLatestRelease();

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Download the Remarks extension</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Remarks extension is in alpha and not yet on the Chrome Web Store. Download the latest
          build below and load it as an unpacked extension in Chrome.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Download the .zip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <DownloadButton release={release} />
          <p>
            Save the file somewhere you won&apos;t accidentally delete it — you&apos;ll need to keep
            the unzipped folder around as long as the extension is installed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Load it as an unpacked extension</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>Unzip the file you just downloaded.</li>
            <li>
              Open <code className="rounded bg-muted px-1">chrome://extensions</code> in a new tab.
            </li>
            <li>
              Toggle <em>Developer mode</em> on (top-right corner).
            </li>
            <li>
              Click <em>Load unpacked</em> and select the unzipped folder.
            </li>
            <li>Pin the Remarks icon in the toolbar so it&apos;s easy to find.</li>
          </ol>
          <p>
            You&apos;re already signed into the dashboard, so the extension picks up your session
            automatically once it loads.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Updating to a new version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Unpacked extensions don&apos;t auto-update. When a new release ships, come back here and
            re-download — the version number on the button always matches the latest release.
          </p>
          <p>
            Check what version you&apos;re currently running by clicking the three-dot menu in the
            Remarks sidebar; the version is shown at the bottom.
          </p>
          <p>
            To upgrade: delete the old folder, download the new zip, unzip it in the same place, and
            click the refresh icon next to Remarks in{" "}
            <code className="rounded bg-muted px-1">chrome://extensions</code>.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
