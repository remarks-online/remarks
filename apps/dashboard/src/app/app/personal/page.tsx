import { getTrpcServer } from "@/lib/trpc-server";
import { auth } from "@clerk/nextjs/server";
import type { AnnotationResponse } from "@remarks/shared";
import Link from "next/link";

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

  const trpc = await getTrpcServer();
  const { items } = await trpc.annotations.listForUser.query({
    scope: "personal",
    limit: 100,
  });

  return (
    <section className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Personal annotations</h1>
      <p className="mt-2 text-muted-foreground">
        Captures you've taken outside any team project. Only you can see these.
      </p>
      {items.length === 0 ? <PersonalEmptyState /> : <PersonalList items={items} />}
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

function PersonalList({ items }: { items: AnnotationResponse[] }) {
  const grouped = groupByHost(items);
  return (
    <div className="mt-6 flex flex-col gap-6">
      {grouped.map(({ host, annotations }) => (
        <div key={host}>
          <h2 className="text-sm font-semibold text-muted-foreground">{host}</h2>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {annotations.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <Link href={a.url} className="text-sm font-medium hover:underline">
                  {a.commentText.split("\n")[0]}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new URL(a.url).pathname} · {new Date(a.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function groupByHost(
  items: AnnotationResponse[]
): Array<{ host: string; annotations: AnnotationResponse[] }> {
  const map = new Map<string, AnnotationResponse[]>();
  for (const item of items) {
    let host: string;
    try {
      host = new URL(item.url).host;
    } catch {
      host = "(unknown)";
    }
    const existing = map.get(host);
    if (existing) existing.push(item);
    else map.set(host, [item]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, annotations]) => ({ host, annotations }));
}
