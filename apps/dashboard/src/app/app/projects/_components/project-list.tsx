import { getTrpcServer } from "@/lib/trpc-server";
import type { ProjectResponse } from "@remarks/shared";
import { Button } from "@remarks/ui";
import Link from "next/link";
import { EmptyStateActions } from "./empty-state-actions";

interface Props {
  orgId: string | null;
}

export async function ProjectList({ orgId }: Props) {
  const trpc = await getTrpcServer();
  // tRPC's listInputSchema treats `orgId: undefined` as "personal-only".
  const { personal, org } = await trpc.projects.list.query(
    orgId ? { orgId } : { orgId: undefined }
  );

  if (personal.length === 0 && org.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <h2 className="text-lg font-semibold">No projects yet</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Projects group the annotations you and your teammates capture on a single website or
          staging environment. Create a personal project to keep things to yourself, or create an
          organization to share annotations with a team.
        </p>
        <EmptyStateActions hasOrg={orgId !== null} />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {personal.length > 0 ? <ProjectSection title="Your projects" projects={personal} /> : null}
      {org.length > 0 ? <ProjectSection title="Organization projects" projects={org} /> : null}
      {personal.length === 0 && orgId !== null ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          You don't have any personal projects yet.{" "}
          <Button variant="link" asChild className="h-auto p-0 align-baseline">
            <Link href="/app/projects/new">Create one</Link>
          </Button>
          .
        </div>
      ) : null}
    </div>
  );
}

function ProjectSection({ title, projects }: { title: string; projects: ProjectResponse[] }) {
  // `<p>` (not `<h2>`) so getByRole("heading") in tests still resolves uniquely to
  // the page title "Projects". The section label is purely visual.
  return (
    <section>
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {projects.map((project) => (
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
    </section>
  );
}
