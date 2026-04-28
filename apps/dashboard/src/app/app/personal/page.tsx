import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import type { AnnotationListResponse } from "@remarks/shared";
import {
  PERSONAL_PAGE_SIZE,
  PersonalAnnotationsBrowser,
} from "./_components/personal-annotations-browser";

export default async function PersonalAnnotationsPage() {
  const { userId } = await auth();
  if (!userId) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Personal annotations</h1>
        <p className="mt-2 text-muted-foreground">Sign in to view your captures.</p>
      </section>
    );
  }

  let initialData: AnnotationListResponse | null = null;
  let loadError: string | null = null;
  try {
    const trpc = await getTrpcServer();
    initialData = await trpc.annotations.listForUser.query({
      scope: "personal",
      limit: PERSONAL_PAGE_SIZE,
    });
  } catch (err) {
    // Log so the digest in the user-visible "Something went wrong" page maps
    // to a real stack in Vercel logs. Without this catch the entire RSC tree
    // crashes with the opaque production error.
    console.error("[personal] failed to load annotations", err);
    loadError = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Personal annotations</h1>
      <p className="mt-2 text-muted-foreground">
        Captures you've taken outside any team project. Only you can see these.
      </p>
      {loadError ? (
        <PersonalErrorState message={loadError} />
      ) : initialData ? (
        <PersonalAnnotationsBrowser initialData={initialData} />
      ) : null}
    </section>
  );
}

function PersonalErrorState({ message }: { message: string }) {
  return (
    <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-6 text-sm">
      <h2 className="text-base font-semibold text-destructive">Couldn't load your annotations</h2>
      <p className="mt-2 text-muted-foreground">
        Try refreshing in a moment. If the problem persists, the API may be unreachable.
      </p>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
