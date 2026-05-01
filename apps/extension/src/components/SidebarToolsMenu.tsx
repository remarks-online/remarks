import { useAuthStatus } from "@/lib/auth-status";
import { pickerStore } from "@/lib/picker-store";
import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@remarks/ui";
import { MousePointer2, SquareDashed, Wrench } from "lucide-react";

export function SidebarToolsMenu() {
  const container = useShadowRootPortalContainer();
  const { signedIn } = useAuthStatus();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Tools">
          <Wrench className="h-4 w-4" />
          <span>Tools</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" container={container} className="w-56">
        <DropdownMenuLabel>Capture</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!signedIn}
          onSelect={() => pickerStore.getState().enterElementMode()}
        >
          <MousePointer2 />
          Pick an element
          <DropdownMenuShortcut>⌘⇧E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!signedIn}
          onSelect={() => pickerStore.getState().enterRectMode()}
        >
          <SquareDashed />
          Draw a rectangle
          <DropdownMenuShortcut>⌘⇧X</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
