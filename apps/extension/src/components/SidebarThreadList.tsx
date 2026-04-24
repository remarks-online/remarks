import { MessageSquarePlus } from "lucide-react";

// Placeholder thread list. Task 1.29 replaces this body with a tRPC-powered
// list; 1.25 only ships the empty state scaffold so docking/compact layouts
// can be verified without server wiring.
export function SidebarThreadList() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageSquarePlus className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">No annotations yet</p>
      <p className="text-xs text-muted-foreground">
        Press{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">C</kbd> to
        pick an element or{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">R</kbd> to
        draw a rectangle.
      </p>
    </div>
  );
}
