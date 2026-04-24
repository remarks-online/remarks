import { SidebarShell } from "@/components/SidebarShell";
import { initPickerController } from "@/lib/picker-controller";
import { ShadowRootProvider } from "@/lib/shadow-root-context";
import { loadSidebarPrefs } from "@/lib/sidebar-prefs";
import { sidebarStore } from "@/lib/sidebar-store";
import { createRoot } from "react-dom/client";
import "@/styles/content.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  allFrames: false,
  async main(ctx) {
    // Hydrate persisted sidebar prefs before the first render so dock/width/
    // compact state land in sync storage and don't flash the defaults.
    const persisted = await loadSidebarPrefs();
    if (persisted) sidebarStore.getState().hydrate(persisted);

    const ui = await createShadowRootUi(ctx, {
      name: "remarks-sidebar",
      position: "inline",
      anchor: "body",
      onMount: (container, shadow) => {
        const mountPoint = document.createElement("div");
        container.append(mountPoint);
        const root = createRoot(mountPoint);
        root.render(
          <ShadowRootProvider value={shadow}>
            <SidebarShell />
          </ShadowRootProvider>
        );
        const picker = initPickerController({ sidebarRoot: shadow });
        return { root, picker };
      },
      onRemove: (mounted) => {
        mounted?.picker.teardown();
        mounted?.root.unmount();
      },
    });

    ui.mount();
  },
});
