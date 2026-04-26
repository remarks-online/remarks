# Runbook: Clerk syncHost setup for the extension

Wire the browser extension to share its Clerk session with a dashboard origin ("syncHost"), so signing into the dashboard signs you into the extension too. This must be done once per Clerk instance (dev and prod are independent).

End state: the popup reads the user's Clerk session from the configured dashboard URL instead of maintaining its own cookie store, and Clerk's `allowed_origins` allowlist accepts the extension's `chrome-extension://<id>` origin.

Prereqs:

- Repo cloned with `apps/extension/wxt.config.ts` containing a committed `key` (see step 2). This pins the extension ID across all "Load unpacked" installs.
- `CLERK_SECRET_KEY` for the target instance. For dev: the `sk_test_…` in `apps/api/.env.local`. For prod: the `sk_live_…` you'll set in Fly secrets (see `docs/runbooks/environments.md`).
- The dashboard reachable at the URL you'll sync from (`http://localhost:3000` for dev, `https://app.remarks.online` for prod).

## 1. Stable extension ID (one-time, already done for dev)

The repo already ships with an RSA public key committed to `apps/extension/wxt.config.ts` (`CRX_PUBLIC_KEY`) and the derived extension ID `baikikfefeheiildmfoaicbjbnbecgjd`. **Do not regenerate unless you're rotating keys** — it would change the extension ID and invalidate every Clerk allowlist entry referencing the old one.

If you ever do need to regenerate:

```sh
mkdir -p .keys                                          # gitignored
openssl genrsa -out .keys/private.pem 2048
openssl rsa -in .keys/private.pem -pubout -outform DER -out .keys/public.der

node -e '
  const fs = require("fs");
  const crypto = require("crypto");
  const der = fs.readFileSync(".keys/public.der");
  console.log("PUB_B64=" + der.toString("base64"));
  const hash = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
  const id = hash.split("").map(c => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
  console.log("EXT_ID=" + id);
'
```

- Copy `PUB_B64` into `CRX_PUBLIC_KEY` in `apps/extension/wxt.config.ts`.
- Store the new `EXT_ID` — you'll need it for the allowlist step below.
- `.keys/private.pem` is only needed if you later pack a `.crx` for non-Chrome-Web-Store distribution. The Chrome Web Store re-signs uploads, so prod extensions installed via the store use a key Google owns, not this one. If you never ship a self-hosted `.crx`, this private key can be discarded.

## 2. Confirm environment variables

`apps/extension/.env` (local, gitignored) must contain:

```env
WXT_CLERK_PUBLISHABLE_KEY=pk_test_…              # from Clerk dashboard
WXT_API_URL=http://localhost:4000                # the Fastify API
WXT_CLERK_SYNC_HOST=http://localhost:3000        # the dashboard origin to sync with
```

For a production build, `WXT_CLERK_SYNC_HOST` flips to `https://app.remarks.online` and `WXT_CLERK_PUBLISHABLE_KEY` flips to the `pk_live_…` value. Vercel/CI builds of the extension get these via `.env.production` or equivalent — not tracked here.

## 3. Allowlist the extension origin at Clerk

Clerk gates which origins may hit the Frontend API. The extension origin must be in the target instance's `allowed_origins`. Use the Backend API (no dashboard clicking required):

```sh
# Dev instance (uses the sk_test_ key in apps/api/.env.local):
set -a && source apps/api/.env.local && set +a
pnpm --filter @remarks/scripts exec tsx clerk-allowlist-extension.ts baikikfefeheiildmfoaicbjbnbecgjd

# Prod instance (when you're ready to ship):
CLERK_SECRET_KEY=sk_live_… pnpm --filter @remarks/scripts exec \
  tsx clerk-allowlist-extension.ts baikikfefeheiildmfoaicbjbnbecgjd
```

The script is at `tools/scripts/clerk-allowlist-extension.ts`. It:

1. GETs `https://api.clerk.com/v1/instance` to read the current `allowed_origins`.
2. Appends `chrome-extension://<id>` if it's not already present (idempotent — safe to re-run).
3. PATCHes `/v1/instance` with the full merged list.

Prints the updated list so you can eyeball the merge. If the script exits non-zero, Clerk's error body is on stderr.

## 4. End-to-end smoke test (local)

1. **Start the dashboard and the extension dev server.** In two terminals:
   ```sh
   pnpm --filter @remarks/dashboard dev          # → http://localhost:3000
   pnpm --filter @remarks/extension dev          # rebuilds to apps/extension/.output/chrome-mv3-dev/
   ```
2. **Load the extension unpacked.** `chrome://extensions` → enable Developer mode → Load unpacked → `apps/extension/.output/chrome-mv3-dev`. Confirm the shown ID is `baikikfefeheiildmfoaicbjbnbecgjd`. If not, the manifest `key` field isn't landing — inspect `.output/chrome-mv3-dev/manifest.json`.
3. **Sign into the dashboard** at `http://localhost:3000/sign-in`. Complete Clerk sign-in.
4. **Open the extension popup.** With `syncHost` working, the popup should render the signed-in UI (`<UserButton />` + `<OrganizationSwitcher />`) without a separate sign-in flow — the session rides in from the dashboard's Clerk cookies.
5. **Negative check.** Sign out of the dashboard → re-open the popup → popup reverts to the signed-out state. (Per Clerk's docs, side-panel and long-lived surfaces may lag; the popup is short-lived and re-checks on each open.)

If the popup insists on a separate sign-in or shows a CORS error in DevTools, recheck:

- `CRX_PUBLIC_KEY` in the manifest matches what produced the extension ID at `chrome://extensions`.
- `chrome-extension://<id>` is in Clerk's `allowed_origins` (re-run step 3).
- `WXT_CLERK_SYNC_HOST` matches the dashboard URL (including scheme and port).
- `apps/extension/wxt.config.ts` `host_permissions` includes the dashboard URL.

## 5. Going to production

Repeat steps 2 and 3 against the prod Clerk instance:

- Build the extension with `WXT_CLERK_SYNC_HOST=https://app.remarks.online` and `WXT_CLERK_PUBLISHABLE_KEY=pk_live_…`.
- Run the allowlist script with `CLERK_SECRET_KEY=sk_live_…`.
- For Chrome Web Store distribution, **the extension ID changes** — the Web Store's signing key supersedes the `key` field in your manifest. After the first Web Store upload, note the assigned ID from the developer dashboard and re-run the allowlist script with that ID against the prod Clerk instance.

## 6. Onboarding install detection (`externally_connectable`)

Task 1.34's onboarding wizard pings the extension from the dashboard to auto-advance step 2 ("Install the Remarks extension"). Wiring lives in:

- `apps/extension/wxt.config.ts` → `manifest.externally_connectable.matches: ["https://app.remarks.online/*", "http://localhost:3000/*"]`
- `apps/extension/src/entrypoints/background.ts` → `chrome.runtime.onMessageExternal` handler responding to `{ kind: "ping" }` with `{ kind: "pong", version, signedIn }`. Origin re-checked inside the handler as defense in depth.
- `apps/dashboard/src/lib/extension-detect.ts` → 1s-timeout wrapper around `chrome.runtime.sendMessage(<extensionId>, ...)`.
- `apps/dashboard/src/env.ts` → `NEXT_PUBLIC_EXTENSION_ID` (defaults to the load-unpacked dev ID `baikikfefeheiildmfoaicbjbnbecgjd`).

ADR 0014 captures the design decision and the alternatives considered.

**Production handoff.** When the Chrome Web Store assigns a different ID after first upload, update `NEXT_PUBLIC_EXTENSION_ID` in Vercel Production *and* re-run the Clerk allowlist script (step 5 above) — both surfaces target the extension by ID.

## References

- `tools/scripts/clerk-allowlist-extension.ts` — the script
- `apps/extension/wxt.config.ts` — where `CRX_PUBLIC_KEY`, `host_permissions`, and `externally_connectable.matches` live
- `apps/extension/src/entrypoints/popup/App.tsx` — the `ClerkProvider syncHost` wiring
- `docs/adr/0014-extension-externally-connectable.md` — install-detection design decision
- Clerk docs: [Sync auth status between your Chrome Extension and web app](https://clerk.com/docs/guides/sessions/sync-host)
- Clerk docs: [Deploy a Chrome Extension to production](https://clerk.com/docs/guides/development/deployment/chrome-extension)
- Clerk Backend API: [Instance Settings](https://clerk.com/docs/reference/backend-api/tag/Instance-Settings)
