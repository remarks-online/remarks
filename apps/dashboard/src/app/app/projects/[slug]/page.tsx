import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnnotationsPanel } from "./_components/annotations-panel";
import { AnnotationsPanelSkeleton } from "./_components/annotations-panel-skeleton";

type Params = Promise<{ slug: string }>;

export default async function ProjectDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const { orgId } = await auth();
  const trpc = await getTrpcServer();

  // Inline pre-stream validation: keeps notFound() ahead of any Suspense flush
  // so /app/projects/<unknown-slug> resolves to a real HTTP 404, not a
  // streamed 200. See docs/plan/spec-gaps.md A7.
  //
  // Resolution order: try the active org's namespace first, then fall back to
  // the caller's personal projects. Slugs may collide between scopes — the
  // active org wins so URL meaning matches the visible context (the
  // OrganizationSwitcher in the header).
  let project: Awaited<ReturnType<typeof trpc.projects.getBySlug.query>> | null = null;
  if (orgId) {
    try {
      project = await trpc.projects.getBySlug.query({ orgId, slug });
    } catch (err) {
      if (!(err instanceof TRPCClientError && err.data?.code === "NOT_FOUND")) {
        throw err;
      }
    }
  }
  if (!project) {
    try {
      project = await trpc.projects.getBySlug.query({ slug });
    } catch (err) {
      if (err instanceof TRPCClientError && err.data?.code === "NOT_FOUND") {
        notFound();
      }
      throw err;
    }
  }

  return (
    <section className="mx-auto max-w-4xl">
      <div>
        <Link href="/app/projects" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to projects
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <div className="flex items-baseline gap-3">
            <p className="text-sm text-muted-foreground">{project.slug}</p>
            <Link
              href={`/app/projects/${project.slug}/settings`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            default branch:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {project.primaryBranch}
            </code>
          </span>
          {project.orgId === null ? (
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium">Personal</span>
          ) : null}
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

      <Suspense fallback={<AnnotationsPanelSkeleton />}>
        <AnnotationsPanel projectId={project.id} primaryBranch={project.primaryBranch} />
      </Suspense>
    </section>
  );
}
