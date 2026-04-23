import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";

export default async function ProjectsPage() {
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-2 text-slate-600">
          Select an organization from the switcher to see its projects.
        </p>
      </section>
    );
  }

  const trpc = await getTrpcServer();
  const { items } = await trpc.projects.list.query({ orgId });

  return (
    <section>
      <h1 className="text-2xl font-semibold">Projects</h1>
      {items.length === 0 ? (
        <p className="mt-2 text-slate-600">No projects yet. Project creation lands in task 1.13.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
          {items.map((project) => (
            <li key={project.id} className="flex items-baseline justify-between px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">{project.name}</p>
                <p className="text-sm text-slate-500">{project.slug}</p>
              </div>
              <p className="text-sm text-slate-500">branch: {project.primaryBranch}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
