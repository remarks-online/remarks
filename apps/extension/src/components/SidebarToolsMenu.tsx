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

interface Props {
  compact: boolean;
}

export function SidebarToolsMenu({ compact }: Props) {
  const container = useShadowRootPortalContainer();
  const { signedIn } = useAuthStatus();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label="Tools"
          className={compact ? "h-8 w-8" : ""}
        >
          <Wrench className="h-4 w-4" />
          {compact ? null : <span>Tools</span>}
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
          <DropdownMenuShortcut>C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!signedIn}
          onSelect={() => pickerStore.getState().enterRectMode()}
        >
          <SquareDashed />
          Draw a rectangle
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
