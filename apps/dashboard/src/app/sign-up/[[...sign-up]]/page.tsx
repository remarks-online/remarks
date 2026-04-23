import { clerkAppearance } from "@/lib/clerk-appearance";
import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <SignUp appearance={clerkAppearance} />
    </main>
  );
}
