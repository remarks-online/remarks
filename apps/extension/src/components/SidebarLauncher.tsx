import { RemarksLogo } from "@/components/RemarksLogo";
import { type Dock, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { useResolvedTheme } from "@/lib/use-host-theme";
import { Button, cn } from "@remarks/ui";

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
        variant="outline"
        size="icon"
        onClick={() => sidebarStore.getState().setVisible(true)}
        className="h-10 w-10 rounded-full shadow-lg"
        aria-label="Open Remarks sidebar"
      >
        <RemarksLogo size={28} />
      </Button>
    </div>
  );
}
