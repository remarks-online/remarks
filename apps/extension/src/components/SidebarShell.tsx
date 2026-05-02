import { AnnotationPinLayer } from "@/components/AnnotationPinLayer";
import { CapturePromptPopover, type DraftClassifiers } from "@/components/CapturePromptPopover";
import { SidebarBranchSelector } from "@/components/SidebarBranchSelector";
import { SidebarCapturePanel } from "@/components/SidebarCapturePanel";
import { SidebarExportMenu } from "@/components/SidebarExportMenu";
import { SidebarHeader } from "@/components/SidebarHeader";
import { SidebarLauncher } from "@/components/SidebarLauncher";
import { SidebarOutboxBanner } from "@/components/SidebarOutboxBanner";
import { SidebarPickerHint } from "@/components/SidebarPickerHint";
import { SidebarResizeHandle } from "@/components/SidebarResizeHandle";
import { SidebarSignedOut } from "@/components/SidebarSignedOut";
import { SidebarStatusTabs } from "@/components/SidebarStatusTabs";
import { SidebarThreadList } from "@/components/SidebarThreadList";
import { env } from "@/env";
import { useAuthStatus } from "@/lib/auth-status";
import { enqueue as enqueueOutbox } from "@/lib/outbox-db";
import { type Capture, pickerStore, usePicker } from "@/lib/picker-store";
import {
  DEFAULT_BRANCH,
  getSelectedBranch,
  setSelectedBranch,
  watchSelectedBranch,
} from "@/lib/selected-branch";
import { getSelectedProjectId, watchSelectedProjectId } from "@/lib/selected-project";
import { PopoverContainerProvider } from "@/lib/shadow-root-context";
import { saveSidebarPrefs, watchSidebarPrefs } from "@/lib/sidebar-prefs";
import { registerSidebarShortcuts } from "@/lib/sidebar-shortcuts";
import { getPersistablePrefs, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { SidebarTrpcProvider } from "@/lib/sidebar-trpc-provider";
import { useResolvedTheme } from "@/lib/use-host-theme";
import { triggerOutboxDrain, useOutboxDrain } from "@/lib/use-outbox-drain";
import { cn } from "@remarks/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

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
  const visible = useSidebar((s) => s.visible);
  const dock = useSidebar((s) => s.dock);
  const width = useSidebar((s) => s.width);
  const height = useSidebar((s) => s.height);

  const resolvedTheme = useResolvedTheme();

  const auth = useAuthStatus();
  const [projectId, setProjectId] = useState<string | null>(null);
  // Sibling of the panel frame; Radix overlays (DropdownMenu, future Select/
  // Popover) portal here so they share `.rmk-root`'s stacking context.
  const [popoverEl, setPopoverEl] = useState<HTMLDivElement | null>(null);

  // Global keyboard shortcuts (⌘⇧F toggle, ⌘⇧⌥R/L/B dock). Registered at the
  // shell level so the listener stays alive while the sidebar is hidden — the
  // body unmounts in that case, so registering there made ⌘⇧F unable to bring
  // the sidebar back.
  useEffect(() => {
    return registerSidebarShortcuts();
  }, []);

  // Persist prefs whenever anything persistable changes.
  useEffect(() => {
    const unsub = sidebarStore.subscribe((state, prev) => {
      const persistable = ["visible", "dock", "width", "height", "theme"] as const;
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

  // When the user signs out, drop any in-flight capture and exit any active
  // picker mode. Without this, a capture taken just before sign-out would
  // resurrect when they sign back in (the picker store is module-singleton).
  useEffect(() => {
    if (auth.signedIn) return;
    pickerStore.getState().cancel();
    pickerStore.getState().clearCapture();
    sidebarStore.getState().setDraftComment("");
  }, [auth.signedIn]);

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

  if (!visible) {
    return <SidebarLauncher />;
  }

  const isVertical = dock === "right" || dock === "left";
  const sizeStyle = isVertical ? { width: `${width}px` } : { height: `${height}px` };

  const styles = dockStyle(dock);

  const body = !auth.signedIn ? (
    <SidebarSignedOut />
  ) : (
    <SidebarTrpcProvider token={auth.token}>
      <SidebarBody projectId={projectId} token={auth.token} clerkOrgId={auth.clerkOrgId} />
    </SidebarTrpcProvider>
  );

  return (
    <div
      className={cn("rmk-root pointer-events-none", styles.container)}
      data-theme={resolvedTheme}
      data-dock={dock}
    >
      <PopoverContainerProvider value={popoverEl}>
        <div
          className={cn(
            "pointer-events-auto relative flex flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl",
            styles.frame
          )}
          style={sizeStyle}
        >
          <SidebarHeader auth={auth} />
          {body}
          <SidebarResizeHandle />
        </div>
        <div ref={setPopoverEl} className="pointer-events-auto" />
      </PopoverContainerProvider>
    </div>
  );
}

interface SidebarBodyProps {
  // Null = personal mode (no team selected). Non-null = team-share mode.
  projectId: string | null;
  token: string | null;
  clerkOrgId: string | null;
}

function SidebarBody({ projectId, token, clerkOrgId }: SidebarBodyProps) {
  const capture = usePicker((s) => s.capture);
  const mode = usePicker((s) => s.mode);
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState<string>(DEFAULT_BRANCH);

  // Hydrate selected branch for the active project, then watch for cross-tab
  // edits so a second tab editing the same project's branch reflects here.
  // Personal mode has no branch concept so this is a no-op there.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void getSelectedBranch(projectId).then((b) => {
      if (!cancelled) setBranch(b);
    });
    const unwatch = watchSelectedBranch(projectId, (b) => setBranch(b));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [projectId]);

  const onBranchChange = useCallback(
    (next: string) => {
      if (!projectId) return;
      setBranch(next);
      void setSelectedBranch(projectId, next);
    },
    [projectId]
  );

  // Both list keys must be invalidated: `list` is the project-scoped query and
  // `listForUser` is the personal-mode query. The sidebar and pin layer both
  // pick one based on whether `projectId` is null, so a successful drain in
  // personal mode would never refresh if we only invalidated `list`.
  const invalidateAnnotationsList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [["annotations", "list"]] });
    void queryClient.invalidateQueries({ queryKey: [["annotations", "listForUser"]] });
  }, [queryClient]);

  useOutboxDrain({
    apiUrl: env.WXT_API_URL,
    token,
    clerkOrgId,
    onSuccess: invalidateAnnotationsList,
  });

  const onSubmit = useCallback(
    async (text: string, cap: Capture | null, classifiers: DraftClassifiers) => {
      if (!cap) return;
      await enqueueOutbox({
        id: crypto.randomUUID(),
        clerkOrgId,
        projectId,
        payload: {
          branch: projectId ? branch : null,
          capture: cap,
          commentText: text,
          intent: classifiers.intent,
          severity: classifiers.severity,
        },
      });
      // Clear the draft + capture immediately so the user can move on; the
      // outbox now owns the item.
      const store = sidebarStore.getState();
      store.setDraftComment("");
      store.setDraftIntent(null);
      store.setDraftSeverity(null);
      pickerStore.getState().clearCapture();
      // Don't await — the drain is a best-effort kick; the 30s interval and
      // window `online` listener (mounted by useOutboxDrain) are the safety
      // nets.
      void triggerOutboxDrain({
        apiUrl: env.WXT_API_URL,
        token,
        clerkOrgId,
        onSuccess: invalidateAnnotationsList,
      });
    },
    [token, projectId, clerkOrgId, branch, invalidateAnnotationsList]
  );

  return (
    <>
      <AnnotationPinLayer projectId={projectId} branch={projectId ? branch : null} />
      {projectId ? <SidebarBranchSelector value={branch} onChange={onBranchChange} /> : null}
      <SidebarStatusTabs
        trailing={<SidebarExportMenu projectId={projectId} branch={projectId ? branch : null} />}
      />
      <div className="flex-1 overflow-y-auto">
        <SidebarThreadList projectId={projectId} branch={projectId ? branch : null} />
      </div>
      {mode !== "idle" && !capture ? (
        <div className="border-t border-border bg-muted/40 px-2 py-1.5">
          <SidebarPickerHint mode={mode} />
        </div>
      ) : null}
      <SidebarOutboxBanner apiUrl={env.WXT_API_URL} token={token} clerkOrgId={clerkOrgId} />
      {capture ? (
        <div className="border-t border-border bg-card p-2">
          <SidebarCapturePanel capture={capture} />
        </div>
      ) : null}
      <CapturePromptPopover onSubmit={onSubmit} />
    </>
  );
}
