import { isExtensionContextValid } from "@/lib/extension-context";
import type { BackgroundRequest, BackgroundResponse } from "@/types";
import { useEffect, useState } from "react";

export interface AuthStatus {
  signedIn: boolean;
  clerkOrgId: string | null;
  token: string | null;
}

const UNKNOWN: AuthStatus = { signedIn: false, clerkOrgId: null, token: null };

export async function fetchAuthStatus(): Promise<AuthStatus> {
  if (!isExtensionContextValid()) return UNKNOWN;
  const request: BackgroundRequest = { kind: "auth-status" };
  try {
    const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse;
    if (response.ok && response.kind === "auth-status") {
      return {
        signedIn: response.signedIn,
        clerkOrgId: response.clerkOrgId,
        token: response.token,
      };
    }
  } catch {
    // Background may be waking up; fall through to unknown.
  }
  return UNKNOWN;
}

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>(UNKNOWN);

  useEffect(() => {
    if (!isExtensionContextValid()) return;
    let cancelled = false;
    void fetchAuthStatus().then((s) => {
      if (!cancelled) setStatus(s);
    });

    // Recover from a sign-in that lands while the panel is mounted but before
    // the background's cookie/Clerk listeners have broadcast. One belated
    // re-fetch is enough — after that, broadcasts handle subsequent changes.
    const recheckTimer = setTimeout(() => {
      void fetchAuthStatus().then((s) => {
        if (!cancelled) setStatus(s);
      });
    }, 1000);

    const listener = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "auth-status-changed"
      ) {
        const next = message as {
          signedIn?: boolean;
          clerkOrgId?: string | null;
          token?: string | null;
        };
        setStatus({
          signedIn: Boolean(next.signedIn),
          clerkOrgId: next.clerkOrgId ?? null,
          token: next.token ?? null,
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      cancelled = true;
      clearTimeout(recheckTimer);
      if (isExtensionContextValid()) {
        chrome.runtime.onMessage.removeListener(listener);
      }
    };
  }, []);

  return status;
}
