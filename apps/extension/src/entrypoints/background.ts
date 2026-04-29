import { env } from "@/env";
import { getActiveClerkOrgId, watchActiveClerkOrgId } from "@/lib/active-org";
import type {
  AuthStatusChangedMessage,
  BackgroundRequest,
  BackgroundResponse,
  ViewportRect,
} from "@/types";
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

// In `background: true` mode the Clerk SDK loads the session once at
// construction (`clerk.load({ standardBrowser: false })`) and doesn't repoll
// the syncHost cookie on its own. If the user signs in on the dashboard after
// the SW has already booted, the cached client keeps reporting `session: null`.
// Invalidate the cache so the next read constructs a fresh client that will
// pick up the new cookie state.
function resetClerk(): void {
  clerkPromise = null;
}

function isJwtExpiredOrNearExpiry(token: string): boolean {
  // Pure decode (not verify) of the JWT exp claim. We only need this to decide
  // whether to bust the SW's cached Clerk client; verifyToken on the API side
  // is the real source of truth.
  const parts = token.split(".");
  if (parts.length !== 3) return true;
  try {
    const payload = JSON.parse(atob(parts[1] ?? ""));
    if (typeof payload.exp !== "number") return true;
    const nowSec = Math.floor(Date.now() / 1000);
    // 5s leeway so a request firing right at the boundary still has time to land.
    return nowSec >= payload.exp - 5;
  } catch {
    return true;
  }
}

async function readAuthStatus(): Promise<{
  signedIn: boolean;
  token: string | null;
  clerkOrgId: string | null;
}> {
  try {
    let clerk = await getClerk();
    let session = clerk.session;
    let token = session ? ((await session.getToken()) ?? null) : null;

    // The headless Clerk SDK in `background: true` mode caches its session
    // view at construction (`clerk.load({ standardBrowser: false })`) and
    // doesn't poll for updates. After ~60s the cached token is past its exp
    // claim and the API's verifyToken rejects it with "Invalid or expired
    // token". Detect that, drop the cached client, and rebuild — the fresh
    // client re-reads syncHost cookies and mints a current token.
    if (token && isJwtExpiredOrNearExpiry(token)) {
      resetClerk();
      clerk = await getClerk();
      session = clerk.session;
      token = session ? ((await session.getToken()) ?? null) : null;
    }
    // Resolve the active org, in priority order:
    //   1. popup-set active org id (the user's explicit OrganizationSwitcher pick)
    //   2. Clerk's `clerk.organization` (set when the user has called setActive)
    //   3. The first org membership on the user — covers the common case where
    //      Clerk auto-created a personal org at signup and the user has never
    //      explicitly "switched" to it. Without this, sidebar.clerkOrgId stays
    //      null forever for any user who hasn't opened the popup, even though
    //      they have exactly one org. (A10 in docs/plan/spec-gaps.md called
    //      this the "popup-open-at-least-once dependency".)
    const storedOrgId = await getActiveClerkOrgId();
    const fallbackOrgId =
      clerk.organization?.id ?? clerk.user?.organizationMemberships?.[0]?.organization?.id ?? null;
    const clerkOrgId = storedOrgId ?? fallbackOrgId;
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

async function captureScreenshot(
  sender: chrome.runtime.MessageSender,
  viewportRect: ViewportRect,
  dpr: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const windowId = sender.tab?.windowId;
  if (windowId === undefined) throw new Error("missing_window_id");

  const fullDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const fullBlob = await (await fetch(fullDataUrl)).blob();

  // captureVisibleTab returns a device-pixel PNG; viewport rect is CSS px, so
  // scale to source pixels. createImageBitmap crops in one shot so we never
  // hold the full-page bitmap in memory twice.
  const sx = Math.max(0, Math.round(viewportRect.x * dpr));
  const sy = Math.max(0, Math.round(viewportRect.y * dpr));
  const sw = Math.max(1, Math.round(viewportRect.width * dpr));
  const sh = Math.max(1, Math.round(viewportRect.height * dpr));

  const bitmap = await createImageBitmap(fullBlob, sx, sy, sw, sh);
  try {
    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("offscreen_2d_unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const croppedBlob = await canvas.convertToBlob({ type: "image/png" });

    // MV3 service workers have no FileReader; hand-encode the PNG as base64.
    const buf = new Uint8Array(await croppedBlob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: loop bounds guarantee in-range.
      binary += String.fromCharCode(buf[i]!);
    }
    const base64 = btoa(binary);
    return { dataUrl: `data:image/png;base64,${base64}`, width: sw, height: sh };
  } finally {
    bitmap.close();
  }
}

// Expose the auth-status reader on globalThis so the Playwright verify suite
// (apps/extension/verify/) can call it via `sw.evaluate()`. Playwright's MV3
// support doesn't reliably dispatch `chrome.runtime.sendMessage` from a popup
// page to the service worker, so the test bypasses messaging entirely. In
// production this global is harmless — nothing reads from it.
declare global {
  var __remarksReadAuthStatus: (() => Promise<unknown>) | undefined;
  var __remarksCaptureScreenshot:
    | ((tabId: number, viewportRect: ViewportRect, dpr: number) => Promise<unknown>)
    | undefined;
}
globalThis.__remarksReadAuthStatus = readAuthStatus;
globalThis.__remarksCaptureScreenshot = async (
  tabId: number,
  viewportRect: ViewportRect,
  dpr: number
) => {
  // Fake a MessageSender with just the windowId; the real handler only reads
  // sender.tab?.windowId. Tests drive the captureVisibleTab path via this hook
  // because Playwright 1.59 doesn't reliably deliver page→SW sendMessage for
  // MV3 (same reason __remarksReadAuthStatus exists).
  const tab = await chrome.tabs.get(tabId);
  return captureScreenshot({ tab } as chrome.runtime.MessageSender, viewportRect, dpr);
};

// Origin allowlist for external (dashboard) pings. Mirrors the manifest's
// externally_connectable.matches (which is already mode-branched in
// wxt.config.ts) so only the dashboard origins can pull a signed-in flag out
// of the SW. Web Store ID change won't affect this — the dashboard side
// identifies the extension by ID, not the other way around. Mode-branched so
// the prod bundle doesn't carry the localhost dev origin (A18).
const EXTERNAL_PING_ALLOWED_ORIGINS = new Set(
  import.meta.env.MODE === "production"
    ? ["https://app.remarks.online"]
    : ["https://app.remarks.online", "http://localhost:3000"]
);

export default defineBackground(() => {
  // Spec §7.5 — `extension_installed` and `extension_signed_in` are detected
  // by the dashboard pinging us. Manifest's `externally_connectable.matches`
  // gates which web origins can sendMessage at all; this handler still does
  // an explicit origin check as defense-in-depth.
  chrome.runtime.onMessageExternal.addListener(
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      const origin = sender.origin ?? sender.url;
      if (!origin || !EXTERNAL_PING_ALLOWED_ORIGINS.has(new URL(origin).origin)) {
        sendResponse({ kind: "denied" });
        return true;
      }
      if (
        message &&
        typeof message === "object" &&
        (message as { kind?: string }).kind === "ping"
      ) {
        readAuthStatus()
          .then((status) =>
            sendResponse({
              kind: "pong",
              version: chrome.runtime.getManifest().version,
              signedIn: status.signedIn,
            })
          )
          .catch(() => {
            // Even if the SDK throws, we still want to confirm install. Treat
            // signed-in as unknown rather than blocking the ack.
            sendResponse({
              kind: "pong",
              version: chrome.runtime.getManifest().version,
              signedIn: false,
            });
          });
        return true;
      }
      sendResponse({ kind: "unknown" });
      return true;
    }
  );

  chrome.runtime.onMessage.addListener(
    (message: BackgroundRequest, sender, sendResponse: (response: BackgroundResponse) => void) => {
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
      if (message.kind === "capture-screenshot") {
        captureScreenshot(sender, message.viewportRect, message.dpr)
          .then(({ dataUrl, width, height }) =>
            sendResponse({ ok: true, kind: "capture-screenshot", dataUrl, width, height })
          )
          .catch((err) => {
            console.warn("[remarks] capture-screenshot failed:", err);
            sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
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

  // Watch for cookie changes on the syncHost (dashboard) and on Clerk's
  // frontend API (`*.clerk.accounts.dev`). Either domain can carry the session
  // cookies that bridge dashboard↔extension. On change, drop the cached Clerk
  // client and re-broadcast — the next readAuthStatus rebuilds the client and
  // picks up the fresh session.
  const syncHostHostname = new URL(env.WXT_CLERK_SYNC_HOST).hostname;
  chrome.cookies.onChanged.addListener((change) => {
    const domain = change.cookie.domain.replace(/^\./, "");
    const matches =
      domain === syncHostHostname ||
      domain.endsWith(".clerk.accounts.dev") ||
      domain === "clerk.accounts.dev";
    if (matches) {
      resetClerk();
      void broadcastAuthStatus();
    }
  });

  // Popup writes the active Clerk org id via `setActiveClerkOrgId`; re-broadcast
  // so the sidebar picks it up without the popup doing a runtime.sendMessage.
  watchActiveClerkOrgId(() => {
    void broadcastAuthStatus();
  });
});
