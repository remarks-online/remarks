import { getTrpcServer } from "@/lib/trpc-server";
import { Button } from "@remarks/ui";
import { FolderPlus } from "lucide-react";
import Link from "next/link";

export async function ProjectList({ orgId }: { orgId: string }) {
  const trpc = await getTrpcServer();
  const { items } = await trpc.projects.list.query({ orgId });

  if (items.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FolderPlus className="h-7 w-7" aria-hidden />
        </div>
        <h2 className="mt-4 text-lg font-semibold">No projects yet</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Projects group the annotations you and your teammates capture on a single website or
          staging environment. Create one to get started.
        </p>
        <Button asChild className="mt-6">
          <Link href="/app/projects/new">Create your first project</Link>
        </Button>
      </div>
    );
  }

  return (
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
  );
}
