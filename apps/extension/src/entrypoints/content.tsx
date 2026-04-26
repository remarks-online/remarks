import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SidebarShell } from "@/components/SidebarShell";
import { fetchAuthStatus } from "@/lib/auth-status";
import { isExtensionContextValid } from "@/lib/extension-context";
import { initPickerController } from "@/lib/picker-controller";
import { ShadowRootProvider } from "@/lib/shadow-root-context";
import { loadSidebarPrefs } from "@/lib/sidebar-prefs";
import { sidebarStore } from "@/lib/sidebar-store";
import { createRoot } from "react-dom/client";
import "@/styles/content.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  // The dashboard is the Remarks app itself — overlaying our own sidebar on
  // it is double-UI and also the place users were most likely to see
  // "Extension context invalidated" after an HMR reload.
  excludeMatches: ["http://localhost:3000/*", "https://app.remarks.online/*"],
  cssInjectionMode: "ui",
  allFrames: false,
  async main(ctx) {
    // Hydrate persisted sidebar prefs before the first render so dock/width/
    // compact state land in sync storage and don't flash the defaults.
    const persisted = await loadSidebarPrefs();
    if (persisted) sidebarStore.getState().hydrate(persisted);

    // Mirror the React-side useAuthStatus channel into a plain boolean the
    // picker controller can consult synchronously. Tracks `auth-status-changed`
    // broadcasts from the background service worker (see entrypoints/background.ts).
    let signedIn = false;
    void fetchAuthStatus().then((status) => {
      signedIn = status.signedIn;
    });
    const onAuthMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "auth-status-changed"
      ) {
        signedIn = Boolean((message as { signedIn?: unknown }).signedIn);
      }
    };
    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener(onAuthMessage);
    }

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
            <ErrorBoundary>
              <SidebarShell />
            </ErrorBoundary>
          </ShadowRootProvider>
        );
        const picker = initPickerController({
          sidebarRoot: shadow,
          isSignedIn: () => signedIn,
          onActivateBlocked: () => {
            // Force the sidebar visible so the existing SidebarSignedOut card
            // is what the user sees when they try to pick while signed out.
            sidebarStore.getState().setVisible(true);
          },
        });
        return { root, picker };
      },
      onRemove: (mounted) => {
        if (isExtensionContextValid()) {
          chrome.runtime.onMessage.removeListener(onAuthMessage);
        }
        mounted?.picker.teardown();
        mounted?.root.unmount();
      },
    });

    ui.mount();
  },
});
