import { type ReactNode, createContext, useContext } from "react";

// The content-script shadow root. Radix primitives portal to this so overlays
// (dropdowns, sheets, selects) stay inside the isolated DOM — matching the
// existing CSS scope and letting the picker controller's `el.getRootNode() ===
// sidebarRoot` guard keep working.
const ShadowRootContext = createContext<ShadowRoot | null>(null);

export function ShadowRootProvider({
  value,
  children,
}: {
  value: ShadowRoot;
  children: ReactNode;
}) {
  return <ShadowRootContext.Provider value={value}>{children}</ShadowRootContext.Provider>;
}

export function useShadowRoot(): ShadowRoot | null {
  return useContext(ShadowRootContext);
}

// Radix's `container` prop is typed as `HTMLElement | null | undefined`. The
// shadow root works at runtime but requires a cast. Document the cast once
// here so callers don't have to repeat the justification.
export function useShadowRootPortalContainer(): HTMLElement | undefined {
  const root = useShadowRoot();
  return (root as unknown as HTMLElement | null) ?? undefined;
}
