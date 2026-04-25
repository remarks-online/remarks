import { type ReactNode, createContext, useContext } from "react";

// The content-script shadow root. Exposed so the picker controller's
// `el.getRootNode() === sidebarRoot` guard keeps working.
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

// Radix overlays portal here. The container is a div *inside* `.rmk-root`
// (sibling of the panel frame), not the shadow root itself, so popups inherit
// `.rmk-root`'s stacking context and the built-in `z-50` wins over the panel
// frame. Portaling to the shadow root made the popup a sibling of the panel,
// where the panel's `z-[2147483646]` won and hid the popup.
const PopoverContainerContext = createContext<HTMLElement | null>(null);

export function PopoverContainerProvider({
  value,
  children,
}: {
  value: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PopoverContainerContext.Provider value={value}>{children}</PopoverContainerContext.Provider>
  );
}

export function useShadowRootPortalContainer(): HTMLElement | undefined {
  return useContext(PopoverContainerContext) ?? undefined;
}
