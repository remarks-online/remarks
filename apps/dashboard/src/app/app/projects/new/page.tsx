import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { NewProjectForm } from "./_components/new-project-form";

export default async function NewProjectPage() {
  const { orgId } = await auth();

  return (
    <section className="mx-auto max-w-md">
      <div className="mb-6">
        <Link href="/app/projects" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to projects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgId
            ? "Create a project to start collecting annotations. Choose whether it belongs to your active organization or to you personally."
            : "Create a personal project. You can attach it to an organization later."}
        </p>
      </div>
      <NewProjectForm orgId={orgId ?? null} />
    </section>
  );
}
