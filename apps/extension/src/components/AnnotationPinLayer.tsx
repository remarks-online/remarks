import { AnnotationEditPopover } from "@/components/AnnotationEditPopover";
import { AnnotationPin } from "@/components/AnnotationPin";
import { trpc } from "@/lib/trpc";
import { useCurrentUrl } from "@/lib/use-current-url";
import type { AnnotationResponse } from "@remarks/shared";
import { useEffect, useState } from "react";

const PAGE_SIZE = 50;

interface Props {
  // Null = personal mode; non-null = the active project context. The pin layer
  // mirrors SidebarThreadList's query selection so both views share the tRPC
  // cache instead of issuing duplicate requests.
  projectId: string | null;
  branch: string | null;
}

interface ViewportState {
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
}

function readViewport(): ViewportState {
  if (typeof window === "undefined") {
    return { scrollX: 0, scrollY: 0, innerWidth: 0, innerHeight: 0 };
  }
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
}

// origin + pathname only; query and hash are ignored so `/page?utm=…#section`
// matches `/page` for pin display purposes.
function pageKey(href: string): string | null {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

export function AnnotationPinLayer({ projectId, branch }: Props) {
  const url = useCurrentUrl();

  // We intentionally don't pass `url` to the server — it filters by exact match,
  // and we want origin+pathname semantics. Instead we filter the cached list
  // (already loaded for the side panel) on the client.
  const projectQuery = trpc.annotations.list.useInfiniteQuery(
    {
      projectId: projectId ?? "",
      branch: branch ?? "",
      url,
      limit: PAGE_SIZE,
    },
    {
      enabled: projectId !== null && branch !== null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );

  const userQuery = trpc.annotations.listForUser.useInfiniteQuery(
    { url, limit: PAGE_SIZE, scope: "all" },
    {
      enabled: projectId === null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );

  const query = projectId !== null ? projectQuery : userQuery;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const [viewport, setViewport] = useState<ViewportState>(() => readViewport());

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setViewport(readViewport());
      });
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const currentKey = pageKey(url);
  const visible: PinDescriptor[] = currentKey
    ? items.flatMap((item) => buildPin(item, currentKey)).filter(Boolean as never)
    : [];

  return (
    <>
      <div className="pointer-events-none fixed inset-0" style={{ zIndex: 2147483645 }}>
        {visible.map((pin) => (
          <AnnotationPin
            key={pin.id}
            annotationId={pin.id}
            cx={pin.docX - viewport.scrollX}
            cy={pin.docY - viewport.scrollY}
          />
        ))}
      </div>
      <AnnotationEditPopover items={items} viewport={viewport} />
    </>
  );
}

interface PinDescriptor {
  id: string;
  docX: number;
  docY: number;
}

function buildPin(item: AnnotationResponse, currentKey: string): PinDescriptor[] {
  if (!item.targetCoords) return [];
  if (pageKey(item.url) !== currentKey) return [];
  const cx = item.targetCoords.x + item.targetCoords.width / 2;
  const cy = item.targetCoords.y + item.targetCoords.height / 2;
  return [{ id: item.id, docX: cx, docY: cy }];
}
