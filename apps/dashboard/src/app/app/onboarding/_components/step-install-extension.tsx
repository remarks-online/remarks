"use client";

import { capture } from "@/lib/analytics";
import { detectExtension } from "@/lib/extension-detect";
import { Button } from "@remarks/ui";
import { CheckCircle2, ChromeIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Read NEXT_PUBLIC_* directly — see analytics.ts for why we don't import the
// server `env` schema from a "use client" module.
const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? "baikikfefeheiildmfoaicbjbnbecgjd";
const CHROME_WEB_STORE_URL = process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL;

interface Props {
  onAdvance: (via: "auto" | "manual", extensionVersion?: string) => void;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes; longer than realistic install times.

export function StepInstallExtension({ onAdvance }: Props) {
  const [status, setStatus] = useState<"polling" | "detected">("polling");
  const [version, setVersion] = useState<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      const result = await detectExtension(EXTENSION_ID);
      if (cancelled) return;
      if (result.installed) {
        setVersion(result.version ?? null);
        setStatus("detected");
        capture("extension_installed", {
          via: "auto",
          extensionVersion: result.version ?? "unknown",
        });
        if (result.signedIn) {
          capture("extension_signed_in", { via: "auto" });
        }
        // Advance after a brief beat so the user sees the green check before
        // the panel changes — the wizard's UX feels jumpy otherwise.
        setTimeout(() => {
          if (!cancelled) onAdvance("auto", result.version);
        }, 600);
        return;
      }
      if (Date.now() - startedAtRef.current >= POLL_TIMEOUT_MS) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onAdvance]);

  function handleManual() {
    capture("extension_installed", { via: "manual" });
    onAdvance("manual");
  }

  const webStoreUrl = CHROME_WEB_STORE_URL;

  return (
    <div className="space-y-6 rounded-md border border-border p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ChromeIcon className="h-6 w-6" aria-hidden />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Add the Remarks extension to Chrome</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The extension lets you click any element on your site and leave a comment that lands in
            this dashboard. You&apos;re already signed in — the extension picks up your dashboard
            session automatically.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {webStoreUrl ? (
          <Button asChild>
            <a href={webStoreUrl} target="_blank" rel="noopener noreferrer">
              Add to Chrome
            </a>
          </Button>
        ) : (
          <Button asChild>
            <a href="https://github.com/breschio/remarks" target="_blank" rel="noopener noreferrer">
              Get the extension
            </a>
          </Button>
        )}
        <Button variant="ghost" onClick={handleManual}>
          I&apos;ve installed it
        </Button>
      </div>

      <div
        aria-live="polite"
        className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
      >
        {status === "detected" ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
            <span>Installed{version ? ` (v${version})` : ""} — moving on…</span>
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">
              Waiting for the extension. We&apos;ll auto-advance as soon as we detect it.
            </span>
          </>
        )}
      </div>

      {!webStoreUrl ? (
        <details className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Loading the extension manually (dev / pre-Web-Store)
          </summary>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>
              Build the extension once:{" "}
              <code className="rounded bg-muted px-1">pnpm --filter @remarks/extension dev</code>.
            </li>
            <li>
              Open <code className="rounded bg-muted px-1">chrome://extensions</code> and enable
              Developer mode.
            </li>
            <li>
              Click <em>Load unpacked</em> and select{" "}
              <code className="rounded bg-muted px-1">apps/extension/.output/chrome-mv3</code>.
            </li>
            <li>Pin the Remarks icon in the toolbar — your dashboard session is already shared.</li>
          </ol>
        </details>
      ) : null}
    </div>
  );
}
