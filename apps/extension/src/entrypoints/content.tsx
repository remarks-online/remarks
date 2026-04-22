import { SidebarShell } from "@/components/SidebarShell";
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
      onMount: (container) => {
        const mountPoint = document.createElement("div");
        container.append(mountPoint);
        const root = createRoot(mountPoint);
        root.render(<SidebarShell />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
