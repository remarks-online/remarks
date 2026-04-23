import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { NewProjectForm } from "./_components/new-project-form";

export default async function NewProjectPage() {
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section className="mx-auto max-w-md">
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="mt-2 text-muted-foreground">
          Select an organization from the switcher first, then return here.
        </p>
        <Link href="/app/projects" className="mt-4 inline-block text-sm text-primary underline">
          Back to projects
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-md">
      <div className="mb-6">
        <Link href="/app/projects" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a project to start collecting annotations.
        </p>
      </div>
      <NewProjectForm orgId={orgId} />
    </section>
  );
}
