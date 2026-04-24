import { env } from "@/env";
import { getActiveClerkOrgId, watchActiveClerkOrgId } from "@/lib/active-org";
import type { AuthStatusChangedMessage, BackgroundRequest, BackgroundResponse } from "@/types";
import { createClerkClient } from "@clerk/chrome-extension/client";
import type { Clerk } from "@clerk/chrome-extension/types";

/**
 * Clerk client hosted in the MV3 service worker. `background: true` tells the
 * SDK it's in a no-DOM context; session state is persisted to chrome.storage
 * (shared with the popup's ClerkProvider) and tokens are refreshed on demand
 * when `session.getToken()` is called. This is Clerk's sanctioned fix for the
 * "popup closes and the cookie goes stale" problem — see spec-gaps.md A10.
 *
 * Lazy-init because service workers wake on events; we don't want every wake
 * to pay the createClerkClient cost up front.
 */
let clerkPromise: Promise<Clerk> | null = null;
function getClerk(): Promise<Clerk> {
  if (!clerkPromise) {
    clerkPromise = createClerkClient({
      publishableKey: env.WXT_CLERK_PUBLISHABLE_KEY,
      syncHost: env.WXT_CLERK_SYNC_HOST,
      background: true,
    });
  }
  return clerkPromise;
}

async function readAuthStatus(): Promise<{
  signedIn: boolean;
  token: string | null;
  clerkOrgId: string | null;
}> {
  try {
    const clerk = await getClerk();
    const session = clerk.session;
    const token = session ? ((await session.getToken()) ?? null) : null;
    const clerkOrgId = await getActiveClerkOrgId();
    return { signedIn: Boolean(session), token, clerkOrgId };
  } catch (err) {
    console.error("[remarks] readAuthStatus failed", err);
    return { signedIn: false, token: null, clerkOrgId: null };
  }
}

async function broadcastAuthStatus() {
  const { signedIn, token, clerkOrgId } = await readAuthStatus();
  const message: AuthStatusChangedMessage = {
    kind: "auth-status-changed",
    signedIn,
    clerkOrgId,
    token,
  };
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    // Tabs without content scripts (chrome://, store pages) will reject the
    // message; swallow the resulting promise rejection.
    void chrome.tabs.sendMessage(tab.id, message).catch(() => {});
  }
}

// Expose the auth-status reader on globalThis so the Playwright verify suite
// (apps/extension/verify/) can call it via `sw.evaluate()`. Playwright's MV3
// support doesn't reliably dispatch `chrome.runtime.sendMessage` from a popup
// page to the service worker, so the test bypasses messaging entirely. In
// production this global is harmless — nothing reads from it.
declare global {
  var __remarksReadAuthStatus: (() => Promise<unknown>) | undefined;
}
globalThis.__remarksReadAuthStatus = readAuthStatus;

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
      if (message.kind === "ping") {
        sendResponse({ ok: true, kind: "ping", pong: Date.now() });
        return true;
      }
      if (message.kind === "auth-status") {
        readAuthStatus()
          .then((status) =>
            sendResponse({
              ok: true,
              kind: "auth-status",
              signedIn: status.signedIn,
              clerkOrgId: status.clerkOrgId,
              token: status.token,
            })
          )
          .catch((err) => {
            console.error("[remarks] auth-status handler threw:", err);
            sendResponse({ ok: false, error: String(err) });
          });
        return true;
      }
      sendResponse({ ok: false, error: "unknown_message_kind" });
      return true;
    }
  );

  // Push `auth-status-changed` whenever Clerk state moves (sign-in, sign-out,
  // token refresh, org switch). Listener fires on the SDK's internal resource
  // updates, which includes cross-surface events delivered via chrome.storage.
  void getClerk().then((clerk) => {
    clerk.addListener(() => {
      void broadcastAuthStatus();
    });
  });

  // Popup writes the active Clerk org id via `setActiveClerkOrgId`; re-broadcast
  // so the sidebar picks it up without the popup doing a runtime.sendMessage.
  watchActiveClerkOrgId(() => {
    void broadcastAuthStatus();
  });
});
