import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import type { AnnotationResponse } from "@remarks/shared";
import { Badge, type BadgeProps, Card, CardContent } from "@remarks/ui";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = Promise<{ slug: string }>;

const STATUS_VARIANT: Record<AnnotationResponse["status"], NonNullable<BadgeProps["variant"]>> = {
  to_do: "outline",
  doing: "default",
  done: "secondary",
  rejected: "destructive",
};

const STATUS_LABEL: Record<AnnotationResponse["status"], string> = {
  to_do: "To do",
  doing: "In progress",
  done: "Done",
  rejected: "Rejected",
};

export default async function ProjectDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">{slug}</h1>
        <p className="mt-2 text-muted-foreground">
          Select an organization from the switcher to view this project.
        </p>
      </section>
    );
  }

  const trpc = await getTrpcServer();

  let project: Awaited<ReturnType<typeof trpc.projects.getBySlug.query>>;
  try {
    project = await trpc.projects.getBySlug.query({ orgId, slug });
  } catch (err) {
    if (err instanceof TRPCClientError && err.data?.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
  }

  const { items } = await trpc.annotations.list.query({
    projectId: project.id,
    limit: 100,
  });

  const groups = groupByBranch(items, project.primaryBranch);

  return (
    <section className="mx-auto max-w-4xl">
      <div>
        <Link href="/app/projects" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to projects
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">{project.slug}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            default branch:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {project.primaryBranch}
            </code>
          </span>
          {project.gitRepoUrl ? (
            <a
              href={project.gitRepoUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate underline underline-offset-2 hover:text-foreground"
            >
              {project.gitRepoUrl}
            </a>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-12 rounded-md border border-dashed border-border p-10 text-center">
          <p className="font-medium">No annotations yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Install the Remarks extension to start capturing annotations on this project.
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {groups.map((group) => (
            <BranchSection
              key={group.branchName}
              branchName={group.branchName}
              annotations={group.annotations}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function groupByBranch(
  items: AnnotationResponse[],
  primaryBranch: string
): Array<{ branchName: string; annotations: AnnotationResponse[] }> {
  const map = new Map<string, AnnotationResponse[]>();
  for (const item of items) {
    const existing = map.get(item.branchName);
    if (existing) existing.push(item);
    else map.set(item.branchName, [item]);
  }
  const entries = Array.from(map.entries());
  entries.sort(([a], [b]) => {
    if (a === primaryBranch) return -1;
    if (b === primaryBranch) return 1;
    return a.localeCompare(b);
  });
  return entries.map(([branchName, annotations]) => ({ branchName, annotations }));
}

function BranchSection({
  branchName,
  annotations,
}: {
  branchName: string;
  annotations: AnnotationResponse[];
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-normal">
            {branchName}
          </code>
        </h2>
        <p className="text-xs text-muted-foreground">
          {annotations.length} annotation{annotations.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4">
        {annotations.map((annotation) => (
          <AnnotationCard key={annotation.id} annotation={annotation} />
        ))}
      </div>
    </div>
  );
}

function AnnotationCard({ annotation }: { annotation: AnnotationResponse }) {
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const hostname = safeHostname(annotation.url);
  const initials = authorInitials(annotation.author);
  const authorLabel = annotation.author.name ?? annotation.author.email ?? "Unknown";

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 p-4">
        <div className="relative h-28 w-44 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
          {screenshot ? (
            <img src={screenshot.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              no preview
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant={STATUS_VARIANT[annotation.status]}>
              {STATUS_LABEL[annotation.status]}
            </Badge>
            <span className="text-xs text-muted-foreground">{annotation.targetType}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <time className="text-xs text-muted-foreground">
              {new Date(annotation.createdAt).toLocaleDateString()}
            </time>
          </div>
          <p className="mt-2 line-clamp-3 text-sm">{annotation.commentText}</p>
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground">
                {initials}
              </span>
              <span className="truncate">{authorLabel}</span>
            </span>
            {hostname ? <span className="truncate">· {hostname}</span> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function authorInitials(author: AnnotationResponse["author"]): string {
  const source = author.name ?? author.email ?? "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  if (first && second) return (first + second).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
