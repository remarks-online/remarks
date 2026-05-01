import { RemarksLogo } from "@/components/RemarksLogo";
import { SidebarMoreMenu } from "@/components/SidebarMoreMenu";
import { SidebarToolsMenu } from "@/components/SidebarToolsMenu";
import type { AuthStatus } from "@/lib/auth-status";
import { countsOf, useOutbox } from "@/lib/outbox-store";
import { sidebarStore } from "@/lib/sidebar-store";
import { Button, cn } from "@remarks/ui";
import { AlertTriangle, CloudUpload, Minus } from "lucide-react";

interface Props {
  auth: AuthStatus;
}

export function SidebarHeader({ auth }: Props) {
  const outboxItems = useOutbox((s) => s.items);
  const counts = countsOf(outboxItems);

  return (
    <header className="flex items-center gap-1 border-b border-border bg-card px-2 py-1.5">
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <RemarksLogo size={24} className="shrink-0" />
        <span className="truncate text-sm font-semibold text-foreground">Remarks</span>
        <span
          aria-label={auth.signedIn ? "Signed in" : "Signed out"}
          title={auth.signedIn ? "Signed in" : "Signed out"}
          className={cn(
            "ml-1 inline-block h-2 w-2 shrink-0 rounded-full",
            auth.signedIn ? "bg-emerald-500" : "bg-muted-foreground/40"
          )}
        />
        {counts.error > 0 ? (
          <span
            aria-label={`${counts.error} failed to sync`}
            title={`${counts.error} failed to sync`}
            className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-destructive"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {counts.error}
          </span>
        ) : counts.pending > 0 ? (
          <span
            aria-label={`Syncing ${counts.pending}`}
            title={`Syncing ${counts.pending}`}
            className="ml-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
          >
            <CloudUpload className="h-3 w-3 animate-pulse" aria-hidden="true" />
            {counts.pending}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-0.5">
        <SidebarToolsMenu />
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
        <SidebarMoreMenu />
      </div>
    </header>
  );
}
