import { SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Remarks</h1>
      <p className="mt-4 text-lg text-slate-600">
        In-context feedback for websites. Annotate, assign, resolve.
      </p>
      <div className="mt-8 flex gap-3">
        <SignedOut>
          <Link href="/sign-in" className="rounded-md border px-4 py-2">
            Sign in
          </Link>
          <Link href="/sign-up" className="rounded-md bg-slate-900 px-4 py-2 text-white">
            Sign up
          </Link>
        </SignedOut>
        <SignedIn>
          <Link href="/app" className="rounded-md bg-slate-900 px-4 py-2 text-white">
            Open app
          </Link>
        </SignedIn>
      </div>
    </main>
  );
}
