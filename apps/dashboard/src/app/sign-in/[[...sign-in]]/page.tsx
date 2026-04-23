import { clerkAppearance } from "@/lib/clerk-appearance";
import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <SignIn appearance={clerkAppearance} />
    </main>
  );
}
