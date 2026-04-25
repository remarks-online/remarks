import { MAX_BRANCH_NAME_LENGTH } from "@remarks/shared";
import { type Unwatch, storage } from "wxt/utils/storage";

export const DEFAULT_BRANCH = "main";

// Scoped by projectId so switching projects swaps the branch without bleeding
// across. Stored in `local` (not `sync`) — different machines may sit on
// different feature branches for the same project.
function key(projectId: string): `local:${string}` {
  return `local:remarks.selectedBranch:${projectId}`;
}

function normalize(value: string | null | undefined): string {
  if (!value) return DEFAULT_BRANCH;
  const trimmed = value.trim();
  if (trimmed.length === 0) return DEFAULT_BRANCH;
  return trimmed.length > MAX_BRANCH_NAME_LENGTH
    ? trimmed.slice(0, MAX_BRANCH_NAME_LENGTH)
    : trimmed;
}

export async function getSelectedBranch(projectId: string): Promise<string> {
  const stored = await storage.getItem<string>(key(projectId));
  return normalize(stored);
}

export function setSelectedBranch(projectId: string, branch: string): Promise<void> {
  return storage.setItem(key(projectId), normalize(branch));
}

export function watchSelectedBranch(projectId: string, cb: (branch: string) => void): Unwatch {
  return storage.watch<string>(key(projectId), (value) => cb(normalize(value)));
}
