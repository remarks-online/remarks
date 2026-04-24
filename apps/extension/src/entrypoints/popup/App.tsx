import { env } from "@/env";
import type { BackgroundRequest, BackgroundResponse } from "@/types";
import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/chrome-extension";

const EXTENSION_URL = chrome.runtime.getURL(".");
const POPUP_URL = `${EXTENSION_URL}popup.html`;

async function pingBackground() {
  const request: BackgroundRequest = { kind: "ping" };
  const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse;
  if (response.ok) {
    console.log("[remarks] background pong", response.pong);
  } else {
    console.error("[remarks] background error", response.error);
  }
}

export function App() {
  return (
    <ClerkProvider
      publishableKey={env.WXT_CLERK_PUBLISHABLE_KEY}
      syncHost={env.WXT_CLERK_SYNC_HOST}
      afterSignOutUrl={POPUP_URL}
      signInFallbackRedirectUrl={POPUP_URL}
      signUpFallbackRedirectUrl={POPUP_URL}
    >
      <main className="popup">
        <header className="popup-header">
          <h1>Remarks</h1>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </header>

        <Show
          when="signed-in"
          fallback={
            <>
              <p>Sign in to start annotating pages.</p>
              <div className="popup-actions">
                <SignInButton mode="modal">
                  <button type="button">Sign in</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button type="button" className="popup-secondary">
                    Create account
                  </button>
                </SignUpButton>
              </div>
            </>
          }
        >
          <OrganizationSwitcher hidePersonal />
          <p className="popup-hint">
            The sidebar is injected on every page. Open a tab to start annotating.
          </p>
          <button type="button" onClick={pingBackground}>
            Ping background
          </button>
        </Show>
      </main>
    </ClerkProvider>
  );
}
