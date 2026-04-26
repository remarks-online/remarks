import { isContextInvalidatedError, isExtensionContextValid } from "@/lib/extension-context";
import { type Unwatch, storage } from "wxt/utils/storage";

// Scoped by Clerk org id so switching orgs swaps the selection without
// bleeding the previous org's project id across.
function key(clerkOrgId: string): `local:${string}` {
  return `local:remarks.selectedProjectId:${clerkOrgId}`;
}

export async function getSelectedProjectId(clerkOrgId: string): Promise<string | null> {
  try {
    return await storage.getItem<string>(key(clerkOrgId));
  } catch (err) {
    if (isContextInvalidatedError(err)) return null;
    throw err;
  }
}

export async function setSelectedProjectId(clerkOrgId: string, projectId: string): Promise<void> {
  try {
    await storage.setItem(key(clerkOrgId), projectId);
  } catch (err) {
    if (!isContextInvalidatedError(err)) throw err;
  }
}

export function watchSelectedProjectId(
  clerkOrgId: string,
  cb: (projectId: string | null) => void
): Unwatch {
  if (!isExtensionContextValid()) return () => {};
  return storage.watch<string>(key(clerkOrgId), (value: string | null) => cb(value));
}
