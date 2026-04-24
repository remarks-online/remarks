import { useEffect, useState } from "react";
import { useSidebar } from "./sidebar-store";

export type ResolvedTheme = "light" | "dark";

function readHostAttr(): ResolvedTheme | null {
  if (typeof document === "undefined") return null;
  const root = document.documentElement;
  const dataTheme = root.dataset.theme?.toLowerCase();
  if (dataTheme === "dark") return "dark";
  if (dataTheme === "light") return "light";
  if (root.classList.contains("dark")) return "dark";
  return null;
}

function readSystem(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useResolvedTheme(): ResolvedTheme {
  const theme = useSidebar((s) => s.theme);
  const [hostTheme, setHostTheme] = useState<ResolvedTheme | null>(() => readHostAttr());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => readSystem());

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setHostTheme(readHostAttr()));
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return hostTheme ?? systemTheme;
}
