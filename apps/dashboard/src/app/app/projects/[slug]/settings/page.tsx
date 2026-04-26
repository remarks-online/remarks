import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteProjectForm } from "./_components/delete-project-form";
import { EditProjectForm } from "./_components/edit-project-form";

type Params = Promise<{ slug: string }>;

export default async function ProjectSettingsPage({ params }: { params: Params }) {
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

  // Inline pre-stream validation so /app/projects/<unknown-slug>/settings
  // resolves to a real HTTP 404 (matches detail page; see spec-gaps.md A7).
  let project: Awaited<ReturnType<typeof trpc.projects.getBySlug.query>>;
  try {
    project = await trpc.projects.getBySlug.query({ orgId, slug });
  } catch (err) {
    if (err instanceof TRPCClientError && err.data?.code === "NOT_FOUND") {
      notFound();
    }
    throw err;
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

      <EditProjectForm orgId={orgId} project={project} />

      <div className="rounded-md border p-4">
        <h2 className="text-base font-medium">Connect an agent</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up Claude Code, Cursor, or any MCP-compatible client to read tasks and update them on
          your behalf.
        </p>
        <Link
          href={`/app/projects/${project.slug}/settings/connect-agent`}
          className="mt-3 inline-flex items-center text-sm font-medium underline"
        >
          Open the install guide →
        </Link>
      </div>

      {project.myRole === "admin" ? (
        <DeleteProjectForm projectId={project.id} projectSlug={project.slug} />
      ) : null}
    </section>
  );
}
