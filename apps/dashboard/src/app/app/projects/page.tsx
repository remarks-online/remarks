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
      <section>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-2 text-muted-foreground">
          Select an organization from the switcher to see its projects.
        </p>
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
