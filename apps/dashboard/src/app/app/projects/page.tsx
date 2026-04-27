import { auth } from "@clerk/nextjs/server";
import { Button } from "@remarks/ui";
import Link from "next/link";
import { Suspense } from "react";
import { ProjectList } from "./_components/project-list";
import { ProjectListSkeleton } from "./_components/project-list-skeleton";

export default async function ProjectsPage() {
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-2 text-muted-foreground">
          You're working in personal mode — captures from the extension save privately to you and
          stay keyed by URL. Create or join a team via the organization switcher above to share
          annotations as a project.
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild>
            <Link href="/app/personal">View personal annotations</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Button asChild>
          <Link href="/app/projects/new">New project</Link>
        </Button>
      </div>
      <Suspense fallback={<ProjectListSkeleton />}>
        <ProjectList orgId={orgId} />
      </Suspense>
    </section>
  );
}
