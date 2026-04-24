import { type Unwatch, storage } from "wxt/utils/storage";

// Scoped by Clerk org id so switching orgs swaps the selection without
// bleeding the previous org's project id across.
function key(clerkOrgId: string): `local:${string}` {
  return `local:remarks.selectedProjectId:${clerkOrgId}`;
}

export function getSelectedProjectId(clerkOrgId: string): Promise<string | null> {
  return storage.getItem<string>(key(clerkOrgId));
}

export function setSelectedProjectId(clerkOrgId: string, projectId: string): Promise<void> {
  return storage.setItem(key(clerkOrgId), projectId);
}

export function watchSelectedProjectId(
  clerkOrgId: string,
  cb: (projectId: string | null) => void
): Unwatch {
  return storage.watch<string>(key(clerkOrgId), (value: string | null) => cb(value));
}
