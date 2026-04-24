import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@remarks/ui";

// Placeholder. Task 1.30 replaces this with a free-text branch input (and
// eventually a GitHub-backed list in Phase 3). For 1.25 we ship the disabled
// shell so the layout is complete.
export function SidebarBranchSelector() {
  const container = useShadowRootPortalContainer();
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Label htmlFor="remarks-branch" className="text-xs text-muted-foreground">
        Branch
      </Label>
      <Select disabled>
        <SelectTrigger
          id="remarks-branch"
          className="h-7 w-full text-xs"
          aria-label="Branch (coming soon)"
        >
          <SelectValue placeholder="main" />
        </SelectTrigger>
        <SelectContent container={container}>
          <SelectItem value="main">main</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
