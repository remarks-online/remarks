import { env } from "@/env";
import type { BackgroundRequest, BackgroundResponse } from "@/types";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/chrome-extension";

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
    <ClerkProvider publishableKey={env.WXT_CLERK_PUBLISHABLE_KEY}>
      <main className="popup">
        <h1>Remarks</h1>
        <Show
          when="signed-in"
          fallback={
            <>
              <p>Sign in to start annotating pages.</p>
              <SignInButton mode="modal">
                <button type="button">Sign in</button>
              </SignInButton>
            </>
          }
        >
          <p>Signed in. The sidebar is injected on every page.</p>
          <UserButton />
          <button type="button" onClick={pingBackground}>
            Ping background
          </button>
        </Show>
      </main>
    </ClerkProvider>
  );
}
