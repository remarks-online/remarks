import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Routing rule:
//   - No active org             → /app/projects (page handles the empty case).
//   - Active org with projects  → /app/projects.
//   - Active org, zero projects,
//     never skipped              → /app/onboarding (first-run wizard).
//
// The skip flag is a cookie so this server-side check works on first paint —
// localStorage isn't available here. The wizard sets the cookie when the user
// clicks "Skip onboarding"; from then on, /app routes straight to /app/projects.
export default async function AppIndexPage(): Promise<never> {
  const { orgId, userId } = await auth();
  if (orgId && userId) {
    const cookieStore = await cookies();
    const skipCookieName = `remarks-onboarding-skipped:${userId}:${orgId}`;
    const skipped = cookieStore.get(skipCookieName)?.value === "1";

    if (!skipped) {
      let zeroProjects = false;
      try {
        const trpc = await getTrpcServer();
        const { items } = await trpc.projects.list.query({ orgId });
        zeroProjects = items.length === 0;
      } catch {
        // API down / tRPC error — don't block the user. Fall through to
        // /app/projects, which has its own error state.
      }
      if (zeroProjects) redirect("/app/onboarding");
    }
  }
  redirect("/app/projects");
}
