import { env } from "@/env";
import { setActiveClerkOrgId } from "@/lib/active-org";
import { TrpcProvider } from "@/lib/trpc-provider";
import type { BackgroundRequest, BackgroundResponse } from "@/types";
import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  UserButton,
  useOrganization,
} from "@clerk/chrome-extension";
import { Button } from "@remarks/ui";
import { useEffect } from "react";
import { ProjectPicker } from "./ProjectPicker";

/**
 * Broadcasts the popup's active Clerk org to chrome.storage so the content
 * script (which has no ClerkProvider) can surface the right selected project
 * and, in turn, per-project tRPC queries. Invisible — only runs an effect.
 */
function ActiveOrgSync() {
  const { organization } = useOrganization();
  useEffect(() => {
    void setActiveClerkOrgId(organization?.id ?? null);
  }, [organization?.id]);
  return null;
}

const EXTENSION_URL = chrome.runtime.getURL(".");
const POPUP_URL = `${EXTENSION_URL}popup.html`;

async function pingBackground() {
  const request: BackgroundRequest = { kind: "ping" };
  const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse;
  if (response.ok && response.kind === "ping") {
    console.log("[remarks] background pong", response.pong);
  } else if (!response.ok) {
    console.error("[remarks] background error", response.error);
  }
}

function openSignIn() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/sign-in` });
}

function openSignUp() {
  void chrome.tabs.create({ url: `${env.WXT_CLERK_SYNC_HOST}/sign-up` });
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
      <TrpcProvider>
        <main className="flex min-w-[360px] flex-col gap-3 bg-background p-4 text-foreground">
          <header className="flex items-center justify-between">
            <h1 className="text-base font-semibold">Remarks</h1>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </header>

          <Show
            when="signed-in"
            fallback={
              <>
                <p className="text-sm text-muted-foreground">Sign in to start annotating pages.</p>
                <div className="flex gap-2">
                  <Button size="sm" type="button" onClick={openSignIn}>
                    Sign in
                  </Button>
                  <Button size="sm" variant="outline" type="button" onClick={openSignUp}>
                    Create account
                  </Button>
                </div>
              </>
            }
          >
            <ActiveOrgSync />
            <OrganizationSwitcher hidePersonal />
            <ProjectPicker />
            <p className="text-xs text-muted-foreground">
              The sidebar is injected on every page. Open a tab to start annotating.
            </p>
            <Button size="sm" variant="ghost" type="button" onClick={pingBackground}>
              Ping background
            </Button>
          </Show>
        </main>
      </TrpcProvider>
    </ClerkProvider>
  );
}
