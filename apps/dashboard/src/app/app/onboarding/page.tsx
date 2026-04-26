import { auth } from "@clerk/nextjs/server";
import { OnboardingWizard } from "./_components/onboarding-wizard";

export default async function OnboardingPage() {
  const { orgId } = await auth();

  if (!orgId) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Welcome to Remarks</h1>
        <p className="mt-2 text-muted-foreground">
          Pick or create an organization in the switcher above to start onboarding.
        </p>
      </section>
    );
  }

  return <OnboardingWizard orgId={orgId} />;
}
