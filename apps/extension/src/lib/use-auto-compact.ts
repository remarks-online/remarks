import { useEffect, useState } from "react";

export const AUTO_COMPACT_THRESHOLD_PX = 420;

export function useAutoCompact(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < AUTO_COMPACT_THRESHOLD_PX;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setCompact(window.innerWidth < AUTO_COMPACT_THRESHOLD_PX);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return compact;
}
