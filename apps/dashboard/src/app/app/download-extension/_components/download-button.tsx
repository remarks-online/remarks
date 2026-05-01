import type { ExtensionRelease } from "@remarks/shared";
import { Button } from "@remarks/ui";

interface Props {
  release: ExtensionRelease | null;
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DownloadButton({ release }: Props) {
  if (!release) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 text-sm">
        No build is published yet. CI publishes a new build on every release — check back in a few
        minutes.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button asChild>
        <a href={release.downloadUrl} download={`remarks-chrome-${release.version}.zip`}>
          Download Remarks v{release.version} (.zip)
        </a>
      </Button>
      <p className="text-xs">
        {formatSize(release.sizeBytes)} · published {formatDate(release.uploadedAt)} · download link
        expires after one hour — refresh this page if it stops working.
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer">SHA-256</summary>
        <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
          {release.sha256}
        </code>
      </details>
    </div>
  );
}
