import { SidebarShell } from "@/components/SidebarShell";
import { initPickerController } from "@/lib/picker-controller";
import { createRoot } from "react-dom/client";
import "@/styles/content.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  allFrames: false,
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "remarks-sidebar",
      position: "inline",
      anchor: "body",
      onMount: (container, shadow) => {
        const mountPoint = document.createElement("div");
        container.append(mountPoint);
        const root = createRoot(mountPoint);
        root.render(<SidebarShell />);
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
