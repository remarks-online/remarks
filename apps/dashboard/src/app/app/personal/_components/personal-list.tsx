"use client";

import { AnnotationDetailSheet } from "@/components/annotations/annotation-detail-sheet";
import type { AnnotationResponse } from "@remarks/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface PersonalListProps {
  items: AnnotationResponse[];
}

interface NormalizedRow {
  id: string;
  pathname: string;
  title: string;
  createdAt: string;
}

export function PersonalList({ items }: PersonalListProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("a");

  const setSelected = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("a", id);
      else params.delete("a");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const grouped = normalize(items);

  return (
    <>
      <div className="mt-6 flex flex-col gap-6">
        {grouped.map(({ host, rows }) => (
          <div key={host}>
            <h2 className="text-sm font-semibold text-muted-foreground">{host}</h2>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {rows.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setSelected(row.id)}
                    className="w-full text-left text-sm font-medium hover:underline focus:outline-none focus-visible:underline"
                  >
                    {row.title}
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.pathname} · {row.createdAt}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <AnnotationDetailSheet
        selectedId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
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
