export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BackgroundRequest =
  | { kind: "ping" }
  | { kind: "auth-status" }
  | {
      kind: "capture-screenshot";
      viewportRect: ViewportRect;
      dpr: number;
    };

export type BackgroundResponse =
  | { ok: true; kind: "ping"; pong: number }
  | {
      ok: true;
      kind: "auth-status";
      signedIn: boolean;
      clerkOrgId: string | null;
      token: string | null;
    }
  | {
      ok: true;
      kind: "capture-screenshot";
      dataUrl: string;
      width: number;
      height: number;
    }
  | { ok: false; error: string };

// Fire-and-forget push from the background service worker to every tab when
// the Clerk session cookie changes. Content scripts listen for this to keep
// the sidebar's signed-in indicator + Bearer token in sync with the popup's
// sign-in state.
export interface AuthStatusChangedMessage {
  kind: "auth-status-changed";
  signedIn: boolean;
  clerkOrgId: string | null;
  token: string | null;
}
