import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteProjectForm } from "./_components/delete-project-form";
import { EditProjectForm } from "./_components/edit-project-form";
import { MoveToOrgForm } from "./_components/move-to-org-form";
import { WebhooksForm } from "./_components/webhooks-form";

type Params = Promise<{ slug: string }>;

export default async function ProjectSettingsPage({ params }: { params: Params }) {
  const { slug } = await params;
  const { orgId } = await auth();
  const trpc = await getTrpcServer();

  // Inline pre-stream validation so /app/projects/<unknown-slug>/settings
  // resolves to a real HTTP 404 (matches detail page; see spec-gaps.md A7).
  // Try org scope first, then personal — same precedence as the detail page.
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
    <section className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link
          href={`/app/projects/${project.slug}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to {project.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Project settings</h1>
      </div>

      <EditProjectForm orgId={project.orgId !== null ? (orgId ?? null) : null} project={project} />

      {project.orgId === null && project.myRole === "admin" ? (
        <MoveToOrgForm project={project} />
      ) : null}

      <div className="rounded-md border p-4">
        <h2 className="text-base font-medium">Connect an agent</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up Claude Code, Cursor, or any MCP-compatible client to read tasks and update them on
          your behalf.
        </p>
        <Link
          href="/app/connect-agent"
          className="mt-3 inline-flex items-center text-sm font-medium underline"
        >
          Open the install guide →
        </Link>
      </div>

      <WebhooksForm projectId={project.id} canManage={project.myRole === "admin"} />

      {project.myRole === "admin" ? (
        <DeleteProjectForm projectId={project.id} projectSlug={project.slug} />
      ) : null}
    </section>
  );
}
