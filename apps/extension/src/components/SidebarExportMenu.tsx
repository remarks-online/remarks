import { env } from "@/env";
import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import { useSidebar } from "@/lib/sidebar-store";
import { trpc } from "@/lib/trpc";
import { useCurrentUrl } from "@/lib/use-current-url";
import { type MarkdownExportScope, renderAnnotationsMarkdown } from "@remarks/shared";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@remarks/ui";
import { Check, Download } from "lucide-react";
import { useState } from "react";

const PAGE_SIZE = 50;

interface Props {
  // Null = personal mode; the same `listForUser` query the thread list uses.
  projectId: string | null;
  branch: string | null;
}

export function SidebarExportMenu({ projectId, branch }: Props) {
  const url = useCurrentUrl();
  const statusFilter = useSidebar((s) => s.statusFilter);
  const intentFilter = useSidebar((s) => s.intentFilter);
  const severityFilter = useSidebar((s) => s.severityFilter);
  const status = statusFilter === "all" ? undefined : statusFilter;
  const intent = intentFilter === "all" ? undefined : intentFilter;
  const severity = severityFilter === "all" ? undefined : severityFilter;
  const container = useShadowRootPortalContainer();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ThreadList already runs these exact queries — calling the same hooks
  // here re-uses React Query's cache, so we read the loaded items without
  // triggering new network requests.
  const projectQuery = trpc.annotations.list.useInfiniteQuery(
    {
      projectId: projectId ?? "",
      branch: branch ?? "",
      url,
      status,
      intent,
      severity,
      limit: PAGE_SIZE,
    },
    {
      enabled: projectId !== null && branch !== null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );
  const userQuery = trpc.annotations.listForUser.useInfiniteQuery(
    { url, status, intent, severity, limit: PAGE_SIZE, scope: "all" },
    {
      enabled: projectId === null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );

  const items =
    (projectId !== null ? projectQuery.data : userQuery.data)?.pages.flatMap((p) => p.items) ?? [];

  const scope: MarkdownExportScope =
    projectId !== null
      ? {
          kind: "project",
          // The sidebar doesn't fetch project metadata, so fall back to the
          // slug carried on each row. If the loaded items don't have one (e.g.,
          // empty list), use a generic label so the header stays readable.
          projectName: items[0]?.projectSlug ?? "Project",
          branchName: branch,
        }
      : { kind: "personal" };

  const handleCopy = async () => {
    try {
      const md = renderAnnotationsMarkdown(items, {
        scope,
        dashboardOrigin: env.WXT_DASHBOARD_URL,
        filters: { status: statusFilter, intent: intentFilter, severity: severityFilter },
      });
      await navigator.clipboard.writeText(md);
      setError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setCopied(false);
      setError(err instanceof Error ? err.message : "Couldn't copy");
      window.setTimeout(() => setError(null), 3000);
    }
  };

  const disabled = items.length === 0;
  const label = error ?? (copied ? "Copied" : "Export");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-xs"
          disabled={disabled}
          aria-label="Export annotations as markdown"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" container={container} className="w-56">
        <DropdownMenuItem onSelect={handleCopy}>Copy as markdown</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
