import { env } from "@/env";
import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import { type Dock, type Theme, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@remarks/ui";
import { ExternalLink, MoreHorizontal } from "lucide-react";

interface Props {
  compact: boolean;
}

function openPopupFallback() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}` });
}

export function SidebarMoreMenu({ compact }: Props) {
  const theme = useSidebar((s) => s.theme);
  const dock = useSidebar((s) => s.dock);
  const manualCompact = useSidebar((s) => s.compact);
  const container = useShadowRootPortalContainer();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="More options"
          className={compact ? "h-8 w-8" : "h-8 w-8"}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" container={container} className="w-64">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => sidebarStore.getState().setTheme(v as Theme)}
        >
          <DropdownMenuRadioItem value="auto">Auto (follow page)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Dock</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={dock}
          onValueChange={(v) => sidebarStore.getState().setDock(v as Dock)}
        >
          <DropdownMenuRadioItem value="right">Right</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="left">Left</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">Bottom</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => sidebarStore.getState().setCompact(!manualCompact)}>
          {manualCompact ? "Expand sidebar" : "Compact mode"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => sidebarStore.getState().setVisible(false)}>
          Hide sidebar
          <DropdownMenuShortcut>⌘⇧F</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Keyboard shortcuts</DropdownMenuLabel>
        <div className="px-2 pb-2 text-xs text-muted-foreground">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt>Pick element</dt>
            <dd className="font-mono">⌘⇧E</dd>
            <dt>Draw rectangle</dt>
            <dd className="font-mono">⌘⇧X</dd>
            <dt>Toggle sidebar</dt>
            <dd className="font-mono">⌘⇧F</dd>
            <dt>Cycle dock</dt>
            <dd className="font-mono">⌘⇧D</dd>
            <dt>Post comment</dt>
            <dd className="font-mono">⌘⏎</dd>
            <dt>Cancel picker</dt>
            <dd className="font-mono">Esc</dd>
          </dl>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openPopupFallback}>
          <ExternalLink />
          Open Remarks dashboard
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
