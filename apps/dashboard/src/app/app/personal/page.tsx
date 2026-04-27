import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import type { AnnotationResponse } from "@remarks/shared";
import { PersonalList } from "./_components/personal-list";

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

  let items: AnnotationResponse[] = [];
  let loadError: string | null = null;
  try {
    const trpc = await getTrpcServer();
    const result = await trpc.annotations.listForUser.query({
      scope: "personal",
      limit: 100,
    });
    items = result.items;
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
      ) : items.length === 0 ? (
        <PersonalEmptyState />
      ) : (
        <PersonalList items={items} />
      )}
    </section>
  );
}

function PersonalEmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <h2 className="text-lg font-semibold">No personal annotations yet</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Use the Remarks browser extension to capture an annotation on any page. It'll land here as
        long as you don't pick a team project in the popup.
      </p>
    </div>
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
