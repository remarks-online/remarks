import { useEffect, useState } from "react";

const POLL_MS = 1000;

function readHref(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

/**
 * Tracks `window.location.href` for the host page. Subscribes to `popstate`
 * (back/forward) and polls every 1s to catch SPA `pushState`/`replaceState`
 * mutations without monkey-patching the host page's `history` globals.
 */
export function useCurrentUrl(): string {
  const [url, setUrl] = useState<string>(() => readHref());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopstate = () => setUrl(readHref());
    window.addEventListener("popstate", onPopstate);
    const interval = window.setInterval(() => {
      const next = readHref();
      setUrl((prev) => (prev === next ? prev : next));
    }, POLL_MS);
    return () => {
      window.removeEventListener("popstate", onPopstate);
      window.clearInterval(interval);
    };
  }, []);

  return url;
}
