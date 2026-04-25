import { DEFAULT_BRANCH } from "@/lib/selected-branch";
import { MAX_BRANCH_NAME_LENGTH } from "@remarks/shared";
import { Input, Label } from "@remarks/ui";
import { type KeyboardEvent, useEffect, useState } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
}

function commit(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_BRANCH;
  return trimmed.length > MAX_BRANCH_NAME_LENGTH
    ? trimmed.slice(0, MAX_BRANCH_NAME_LENGTH)
    : trimmed;
}

export function SidebarBranchSelector({ value, onChange }: Props) {
  const [draft, setDraft] = useState(value);

  // Sync draft when external value changes (e.g., another tab edited the
  // stored branch). Ignore drafts that match the new value to avoid
  // clobbering an in-progress edit on the current tab.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commitDraft() {
    const next = commit(draft);
    if (next !== draft) setDraft(next);
    if (next !== value) onChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      event.currentTarget.blur();
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
      <Label htmlFor="remarks-branch" className="text-xs text-muted-foreground">
        Branch
      </Label>
      <Input
        id="remarks-branch"
        type="text"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={MAX_BRANCH_NAME_LENGTH}
        placeholder={DEFAULT_BRANCH}
        aria-label="Branch"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={handleKeyDown}
        className="h-7 flex-1 text-xs"
      />
    </div>
  );
}
