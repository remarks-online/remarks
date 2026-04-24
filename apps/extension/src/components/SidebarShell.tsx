import { SidebarBranchSelector } from "@/components/SidebarBranchSelector";
import { SidebarComposeBox, type SidebarComposeBoxHandle } from "@/components/SidebarComposeBox";
import { SidebarHeader } from "@/components/SidebarHeader";
import { SidebarLauncher } from "@/components/SidebarLauncher";
import { SidebarNoProject } from "@/components/SidebarNoProject";
import { SidebarPickerHint } from "@/components/SidebarPickerHint";
import { SidebarResizeHandle } from "@/components/SidebarResizeHandle";
import { SidebarSignedOut } from "@/components/SidebarSignedOut";
import { SidebarStatusTabs } from "@/components/SidebarStatusTabs";
import { SidebarThreadList } from "@/components/SidebarThreadList";
import { useAuthStatus } from "@/lib/auth-status";
import { usePicker } from "@/lib/picker-store";
import { getSelectedProjectId, watchSelectedProjectId } from "@/lib/selected-project";
import { saveSidebarPrefs, watchSidebarPrefs } from "@/lib/sidebar-prefs";
import { registerSidebarShortcuts } from "@/lib/sidebar-shortcuts";
import { getPersistablePrefs, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { SidebarTrpcProvider } from "@/lib/sidebar-trpc-provider";
import { useAutoCompact } from "@/lib/use-auto-compact";
import { useResolvedTheme } from "@/lib/use-host-theme";
import { cn } from "@remarks/ui";
import { useEffect, useRef, useState } from "react";

interface DockStyle {
  container: string;
  frame: string;
}

function dockStyle(dock: string): DockStyle {
  if (dock === "right") {
    return {
      container: "fixed right-3 top-3 bottom-3 z-[2147483646]",
      frame: "h-full",
    };
  }
  if (dock === "left") {
    return {
      container: "fixed left-3 top-3 bottom-3 z-[2147483646]",
      frame: "h-full",
    };
  }
  return {
    container: "fixed inset-x-3 bottom-3 z-[2147483646]",
    frame: "w-full",
  };
}

export function SidebarShell() {
  const mode = usePicker((s) => s.mode);
  const capture = usePicker((s) => s.capture);

  const visible = useSidebar((s) => s.visible);
  const dock = useSidebar((s) => s.dock);
  const manualCompact = useSidebar((s) => s.compact);
  const width = useSidebar((s) => s.width);
  const height = useSidebar((s) => s.height);

  const auto = useAutoCompact();
  const compact = manualCompact || auto;
  const resolvedTheme = useResolvedTheme();

  const auth = useAuthStatus();
  const [projectId, setProjectId] = useState<string | null>(null);

  // Persist prefs whenever anything persistable changes.
  useEffect(() => {
    const unsub = sidebarStore.subscribe((state, prev) => {
      const persistable = ["visible", "dock", "compact", "width", "height", "theme"] as const;
      const changed = persistable.some((k) => state[k] !== prev[k]);
      if (changed) saveSidebarPrefs(getPersistablePrefs(state));
    });
    return unsub;
  }, []);

  // Hydrate from cross-device sync changes (another Chrome profile edited prefs).
  useEffect(() => {
    const unwatch = watchSidebarPrefs((next) => {
      if (next) sidebarStore.getState().hydrate(next);
    });
    return unwatch;
  }, []);

  // Track selected project for the current Clerk org.
  useEffect(() => {
    if (!auth.clerkOrgId) {
      setProjectId(null);
      return;
    }
    let cancelled = false;
    void getSelectedProjectId(auth.clerkOrgId).then((id) => {
      if (!cancelled) setProjectId(id);
    });
    const unwatch = watchSelectedProjectId(auth.clerkOrgId, (id) => setProjectId(id));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [auth.clerkOrgId]);

  // Shortcut: F focuses the compose textarea.
  const composeRef = useRef<SidebarComposeBoxHandle | null>(null);
  useEffect(() => {
    return registerSidebarShortcuts({
      onFocusCompose: () => composeRef.current?.focus(),
    });
  }, []);

  if (!visible) {
    return <SidebarLauncher />;
  }

  const isVertical = dock === "right" || dock === "left";
  const sizeStyle = isVertical ? { width: `${width}px` } : { height: `${height}px` };

  const styles = dockStyle(dock);

  const body = !auth.signedIn ? (
    <SidebarSignedOut />
  ) : !projectId ? (
    <SidebarNoProject />
  ) : (
    <SidebarTrpcProvider token={auth.token}>
      <SidebarBranchSelector />
      <SidebarStatusTabs compact={compact} />
      <div className="flex-1 overflow-y-auto">
        <SidebarThreadList />
      </div>
      {mode !== "idle" && !capture ? (
        <div className="border-t border-border bg-muted/40 px-2 py-1.5">
          <SidebarPickerHint mode={mode} />
        </div>
      ) : null}
      <SidebarComposeBox ref={composeRef} capture={capture} />
    </SidebarTrpcProvider>
  );

  return (
    <div
      className={cn("rmk-root pointer-events-none", styles.container)}
      data-theme={resolvedTheme}
      data-dock={dock}
      data-compact={compact ? "true" : "false"}
    >
      <div
        className={cn(
          "pointer-events-auto relative flex flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl",
          styles.frame
        )}
        style={sizeStyle}
      >
        <SidebarHeader compact={compact} auth={auth} />
        {body}
        <SidebarResizeHandle />
      </div>
    </div>
  );
}
