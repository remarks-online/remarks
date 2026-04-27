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

interface NormalizedRow {
  id: string;
  href: string;
  pathname: string;
  title: string;
  createdAt: string;
}

function normalize(items: AnnotationResponse[]): Array<{ host: string; rows: NormalizedRow[] }> {
  const byHost = new Map<string, NormalizedRow[]>();
  for (const item of items) {
    let host = "(unknown)";
    let pathname = item.url;
    try {
      const u = new URL(item.url);
      host = u.host;
      pathname = u.pathname || "/";
    } catch {
      // keep fallbacks
    }
    let createdAt = item.createdAt;
    const parsed = new Date(item.createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      createdAt = parsed.toLocaleString();
    }
    const row: NormalizedRow = {
      id: item.id,
      href: item.url,
      pathname,
      title: item.commentText.split("\n")[0] || "(no comment)",
      createdAt,
    };
    const existing = byHost.get(host);
    if (existing) existing.push(row);
    else byHost.set(host, [row]);
  }
  return Array.from(byHost.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, rows]) => ({ host, rows }));
}

function PersonalList({ items }: { items: AnnotationResponse[] }) {
  const grouped = normalize(items);
  return (
    <div className="mt-6 flex flex-col gap-6">
      {grouped.map(({ host, rows }) => (
        <div key={host}>
          <h2 className="text-sm font-semibold text-muted-foreground">{host}</h2>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {rows.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <Link href={row.href} className="text-sm font-medium hover:underline">
                  {row.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.pathname} · {row.createdAt}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
