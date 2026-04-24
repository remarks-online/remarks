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
import { env } from "@/env";
import { useAuthStatus } from "@/lib/auth-status";
import { type Capture, pickerStore, usePicker } from "@/lib/picker-store";
import { getSelectedProjectId, watchSelectedProjectId } from "@/lib/selected-project";
import { saveSidebarPrefs, watchSidebarPrefs } from "@/lib/sidebar-prefs";
import { registerSidebarShortcuts } from "@/lib/sidebar-shortcuts";
import { getPersistablePrefs, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { SidebarTrpcProvider } from "@/lib/sidebar-trpc-provider";
import { UploadAnnotationError, uploadAnnotation } from "@/lib/upload-annotation";
import { useAutoCompact } from "@/lib/use-auto-compact";
import { useResolvedTheme } from "@/lib/use-host-theme";
import { cn } from "@remarks/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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

type SubmitState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string };

export function SidebarShell() {
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
      <SidebarBody projectId={projectId} token={auth.token} compact={compact} />
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

interface SidebarBodyProps {
  projectId: string;
  token: string | null;
  compact: boolean;
}

function SidebarBody({ projectId, token, compact }: SidebarBodyProps) {
  const capture = usePicker((s) => s.capture);
  const mode = usePicker((s) => s.mode);
  const queryClient = useQueryClient();
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const composeRef = useRef<SidebarComposeBoxHandle | null>(null);

  // Shortcut: F focuses the compose textarea. Lives here so the ref stays
  // colocated with the component that owns it.
  useEffect(() => {
    return registerSidebarShortcuts({
      onFocusCompose: () => composeRef.current?.focus(),
    });
  }, []);

  const onSubmit = useCallback(
    async (text: string, cap: Capture | null) => {
      if (!token || !cap || submit.status === "uploading") return;
      setSubmit({ status: "uploading" });
      try {
        await uploadAnnotation({
          token,
          apiUrl: env.WXT_API_URL,
          projectId,
          branch: "main", // TODO(task 1.30): thread selected branch from SidebarBranchSelector.
          capture: cap,
          commentText: text,
        });
        sidebarStore.getState().setDraftComment("");
        pickerStore.getState().clearCapture();
        // Literal tRPC v10 query key for `annotations.list`. task 1.29 can
        // switch to `getQueryKey(trpc.annotations.list)` if it wants
        // finer-grained filters.
        await queryClient.invalidateQueries({ queryKey: [["annotations", "list"]] });
        setSubmit({ status: "idle" });
      } catch (err) {
        setSubmit({
          status: "error",
          message:
            err instanceof UploadAnnotationError
              ? `${err.step} failed: ${err.message}`
              : "Upload failed. Please try again.",
        });
      }
    },
    [token, projectId, queryClient, submit.status]
  );

  return (
    <>
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
      <SidebarComposeBox
        ref={composeRef}
        capture={capture}
        onSubmit={capture ? onSubmit : undefined}
        disabled={submit.status === "uploading"}
        error={submit.status === "error" ? submit.message : undefined}
      />
    </>
  );
}
