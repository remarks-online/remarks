"use client";

export interface ExtensionPingResult {
  installed: boolean;
  version?: string;
  signedIn?: boolean;
}

interface ExtensionPingResponse {
  kind: "pong";
  version: string;
  signedIn: boolean;
}

// `chrome.runtime.sendMessage(<extensionId>, ...)` only resolves when the
// extension's manifest declares the dashboard origin in `externally_connectable.matches`
// — see apps/extension/wxt.config.ts and ADR 0014. Any other case (no extension
// installed, wrong origin, Firefox/Safari without a chrome runtime exposed to
// pages) lands in catch and we report `{ installed: false }`.
export async function detectExtension(
  extensionId: string,
  timeoutMs = 1000
): Promise<ExtensionPingResult> {
  if (typeof window === "undefined") return { installed: false };
  // chrome runtime types live in `@types/chrome`, which we don't ship to the
  // dashboard. Narrow once at the boundary via `unknown`.
  type ChromeRuntime = {
    sendMessage: (id: string, message: unknown, callback: (response: unknown) => void) => void;
    lastError?: { message?: string };
  };
  const chromeRuntime = (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome
    ?.runtime;
  if (!chromeRuntime?.sendMessage) return { installed: false };

  return new Promise<ExtensionPingResult>((resolve) => {
    let settled = false;
    const finish = (result: ExtensionPingResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => finish({ installed: false }), timeoutMs);

    try {
      chromeRuntime.sendMessage(extensionId, { kind: "ping" }, (response: unknown) => {
        clearTimeout(timer);
        if (chromeRuntime.lastError) {
          // Common when the extension isn't installed or isn't listening.
          finish({ installed: false });
          return;
        }
        if (
          response &&
          typeof response === "object" &&
          (response as ExtensionPingResponse).kind === "pong"
        ) {
          const r = response as ExtensionPingResponse;
          finish({ installed: true, version: r.version, signedIn: r.signedIn });
          return;
        }
        finish({ installed: false });
      });
    } catch {
      clearTimeout(timer);
      finish({ installed: false });
    }
  });
}
