# 0014. Extension externally_connectable for install detection

Date: 2026-04-26
Status: Accepted

## Context

Spec §7.5 requires an `extension_installed` PostHog event captured "via extension pinging dashboard on install." Phase 1's onboarding wizard (§14 task 1.34) needs a real signal that the user has installed and loaded the Remarks extension so step 2 ("Install the Remarks extension") can auto-advance instead of relying on a manual "I've installed it" confirmation.

Three options were considered:

1. Extension content script injects a flag (`window.__remarksInstalled`) into the dashboard page on load. Requires expanding `host_permissions` and the content-script matches to include the dashboard origin (already present from A8/A10) and a per-tab race window before the flag is readable.
2. Extension calls a dashboard webhook on install via `chrome.runtime.onInstalled`. Adds a server-side endpoint, requires user identity to attribute the event correctly, and races against the user being signed in yet.
3. Dashboard pulls — `chrome.runtime.sendMessage(<extensionId>, { kind: "ping" })` — once the extension's manifest declares `externally_connectable.matches` for the dashboard origin. Synchronous from the dashboard's perspective, no host-page DOM mutation, no server endpoint.

Option 3 is the standard pattern Chromium-based extensions use for site-side install detection (Notion, 1Password, Grammarly all rely on it).

## Decision

Add `externally_connectable.matches: ["https://app.remarks.online/*", "http://localhost:3000/*"]` to `apps/extension/wxt.config.ts`. The background service worker (`apps/extension/src/entrypoints/background.ts`) registers a `chrome.runtime.onMessageExternal` handler that, after an explicit origin check against the same allowlist, responds to `{ kind: "ping" }` with `{ kind: "pong", version, signedIn }`. The `signedIn` flag reuses the headless `createClerkClient({ background: true })` from ADR-equivalent A10.

Dashboard side: `apps/dashboard/src/lib/extension-detect.ts` wraps `chrome.runtime.sendMessage` with a 1s timeout and returns `{ installed, version?, signedIn? }`. The onboarding wizard's step-2 component polls every 2s. The wizard preserves a manual "I've installed it" fallback for users on browsers without `chrome.runtime` exposed to web pages (Firefox, Safari) and for organizations whose Chromium policy blocks external messaging.

The extension ID the dashboard targets is supplied via the new `NEXT_PUBLIC_EXTENSION_ID` env var, defaulting to the load-unpacked dev ID `baikikfefeheiildmfoaicbjbnbecgjd` pinned by the committed `manifest.key` (A8). Production overrides this once the Chrome Web Store assigns a final ID.

## Consequences

- **Surface area**: One additional manifest field, exposed only to the two dashboard origins. Per CLAUDE.md §12 ("Extension manifest permissions: minimum needed"), this is the narrowest scope that satisfies §7.5.
- **Cross-browser**: Firefox and Safari don't expose `chrome.runtime` to web pages by default. Detection naturally falls through to the manual confirmation, so non-Chromium users see a slightly less polished but functional flow. No code path branches on browser detection.
- **Web Store handoff**: When the extension is published, `NEXT_PUBLIC_EXTENSION_ID` in Vercel Production must be updated to the assigned Web Store ID; otherwise the dashboard pings the dev-only ID and detection silently fails. Documented in `docs/runbooks/extension-clerk-synchost.md` alongside the existing Clerk allowlist re-run step.
- **Future use**: The same handler can answer additional message kinds (`open-extension`, `start-capture`) when later wizards or deep-linking flows need them, without further manifest changes.

## Alternatives considered

- **Content-script injected flag** (option 1): rejected because it depends on tab-load timing — a user who already has the dashboard open when they install the extension wouldn't get the flag injected on the current tab, requiring a refresh.
- **Webhook from extension to API on install** (option 2): rejected because `chrome.runtime.onInstalled` fires before the user signs into the extension; attributing the event to a user requires either anonymous events or a delayed capture, both of which are noisier than the polled-detect approach.
