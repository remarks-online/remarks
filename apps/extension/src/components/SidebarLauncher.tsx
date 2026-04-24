import { type Dock, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { useResolvedTheme } from "@/lib/use-host-theme";
import { Button, cn } from "@remarks/ui";
import { MessageSquare } from "lucide-react";

function anchorFor(dock: Dock): string {
  if (dock === "right") return "right-4 bottom-4";
  if (dock === "left") return "left-4 bottom-4";
  return "right-4 bottom-4";
}

export function SidebarLauncher() {
  const visible = useSidebar((s) => s.visible);
  const dock = useSidebar((s) => s.dock);
  const theme = useResolvedTheme();
  if (visible) return null;

  return (
    <div className={cn("rmk-root fixed z-[2147483647]", anchorFor(dock))} data-theme={theme}>
      <Button
        variant="default"
        size="icon"
        onClick={() => sidebarStore.getState().setVisible(true)}
        className="h-10 w-10 rounded-full shadow-lg"
        aria-label="Open Remarks sidebar"
      >
        <MessageSquare className="h-4 w-4" />
      </Button>
    </div>
  );
}
