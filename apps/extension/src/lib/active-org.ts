import { isContextInvalidatedError, isExtensionContextValid } from "@/lib/extension-context";
import { storage } from "wxt/utils/storage";

// The currently-active Clerk org id, as decided by the popup's
// `useOrganization()` hook. Surfaced to content-script scope (which doesn't
// run a ClerkProvider) via chrome.storage.local so the sidebar can look up
// `selectedProjectId:<orgId>` without embedding Clerk.
const ACTIVE_ORG_KEY = "local:remarks.activeClerkOrgId" as const;

export async function getActiveClerkOrgId(): Promise<string | null> {
  try {
    return await storage.getItem<string>(ACTIVE_ORG_KEY);
  } catch (err) {
    if (isContextInvalidatedError(err)) return null;
    throw err;
  }
}

export async function setActiveClerkOrgId(id: string | null): Promise<void> {
  try {
    if (id === null) await storage.removeItem(ACTIVE_ORG_KEY);
    else await storage.setItem(ACTIVE_ORG_KEY, id);
  } catch (err) {
    if (!isContextInvalidatedError(err)) throw err;
  }
}

export function watchActiveClerkOrgId(cb: (id: string | null) => void): () => void {
  if (!isExtensionContextValid()) return () => {};
  return storage.watch<string>(ACTIVE_ORG_KEY, (value) => cb(value));
}
