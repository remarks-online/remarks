import { getTrpcServer } from "@/lib/trpc-server";

export default async function ProjectsPage() {
  const trpc = await getTrpcServer();
  const { user } = await trpc.me.getCurrentUser.query();
  const greeting = user.name ?? user.email ?? "there";

  return (
    <section>
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-2 text-slate-600">
        Welcome, {greeting}. No projects yet. Project creation lands in Task 1.13.
      </p>
    </section>
  );
}
