import { SidebarMoreMenu } from "@/components/SidebarMoreMenu";
import { SidebarToolsMenu } from "@/components/SidebarToolsMenu";
import type { AuthStatus } from "@/lib/auth-status";
import { sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { Badge, Button, cn } from "@remarks/ui";
import { LayoutPanelLeft, Minus } from "lucide-react";

interface Props {
  compact: boolean;
  auth: AuthStatus;
}

export function SidebarHeader({ compact, auth }: Props) {
  const dock = useSidebar((s) => s.dock);
  const dockLabel = dock === "right" ? "Right" : dock === "left" ? "Left" : "Bottom";

  return (
    <header className="flex items-center gap-1 border-b border-border bg-card px-2 py-1.5">
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground"
          )}
        >
          R
        </span>
        {compact ? null : (
          <span className="truncate text-sm font-semibold text-foreground">Remarks</span>
        )}
        <span
          aria-label={auth.signedIn ? "Signed in" : "Signed out"}
          title={auth.signedIn ? "Signed in" : "Signed out"}
          className={cn(
            "ml-1 inline-block h-2 w-2 shrink-0 rounded-full",
            auth.signedIn ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
      </div>

      <div className="flex items-center gap-0.5">
        <SidebarToolsMenu compact={compact} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Dock: ${dockLabel} (click to cycle)`}
          title={`Dock: ${dockLabel}`}
          className="h-8 w-8"
          onClick={() => sidebarStore.getState().cycleDock()}
        >
          <LayoutPanelLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Minimize sidebar"
          title="Minimize"
          className="h-8 w-8"
          onClick={() => sidebarStore.getState().setVisible(false)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <SidebarMoreMenu compact={compact} />
        {compact ? null : (
          <Badge variant="secondary" className="ml-1 hidden lg:inline-flex">
            {dockLabel}
          </Badge>
        )}
      </div>
    </header>
  );
}
