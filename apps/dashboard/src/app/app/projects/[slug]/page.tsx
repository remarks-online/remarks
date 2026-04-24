import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { TRPCClientError } from "@trpc/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ANNOTATION_LIST_PAGE_SIZE, AnnotationsBrowser } from "./_components/annotations-browser";

type Params = Promise<{ slug: string }>;

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

  const initialList = await trpc.annotations.list.query({
    projectId: project.id,
    limit: ANNOTATION_LIST_PAGE_SIZE,
  });

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

      <AnnotationsBrowser
        projectId={project.id}
        initialData={initialList}
        primaryBranch={project.primaryBranch}
      />
    </section>
  );
}
