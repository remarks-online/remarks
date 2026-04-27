import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Routing rule:
//   - Signed-in user, never skipped/finished onboarding → /app/onboarding.
//   - Signed-in user, skip cookie present              → /app/projects.
//   - Signed-out                                       → middleware sends to /sign-in.
//
// The skip flag is a cookie so this server-side check works on first paint —
// localStorage isn't available here. The wizard sets the cookie when the user
// clicks "Skip onboarding" or completes the success step. Keyed by userId only:
// onboarding is per-person, not per-workspace, so creating or joining an org
// later doesn't re-trigger the wizard.
export default async function AppIndexPage(): Promise<never> {
  const { userId } = await auth();
  if (userId) {
    const cookieStore = await cookies();
    const skipCookieName = `remarks-onboarding-skipped:${userId}`;
    const skipped = cookieStore.get(skipCookieName)?.value === "1";
    if (!skipped) redirect("/app/onboarding");
  }
  redirect("/app/projects");
}
