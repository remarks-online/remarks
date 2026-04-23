import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <section className="mx-auto max-w-md text-center">
      <h1 className="text-2xl font-semibold">Project not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This project doesn&apos;t exist in your current organization.
      </p>
      <Link
        href="/app/projects"
        className="mt-6 inline-block text-sm text-primary underline underline-offset-4"
      >
        ← Back to projects
      </Link>
    </section>
  );
}
