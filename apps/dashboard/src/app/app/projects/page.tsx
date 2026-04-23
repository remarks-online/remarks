import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@remarks/ui";
import Link from "next/link";

export default async function ProjectsPage() {
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-2 text-muted-foreground">
          Select an organization from the switcher to see its projects.
        </p>
      </section>
    );
  }

  const trpc = await getTrpcServer();
  const { items } = await trpc.projects.list.query({ orgId });

  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Button asChild>
          <Link href="/app/projects/new">New project</Link>
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="mt-8 rounded-md border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground">No projects yet.</p>
          <Button asChild className="mt-4">
            <Link href="/app/projects/new">Create your first project</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {items.map((project) => (
            <li key={project.id}>
              <Link
                href={`/app/projects/${project.slug}`}
                className="flex items-baseline justify-between px-4 py-3 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium">{project.name}</p>
                  <p className="text-sm text-muted-foreground">{project.slug}</p>
                </div>
                <p className="text-sm text-muted-foreground">branch: {project.primaryBranch}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
