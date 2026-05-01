# 0017. Alpha extension distribution via R2

Date: 2026-05-01
Status: Accepted

## Context

The Remarks Chrome extension is not yet on the Chrome Web Store (still spec-gap A8). We have alpha testers — friends, family, invited users — who need to install the extension before Web Store submission lands. Today the only path is asking the founder to build and zip it locally, which doesn't scale and breaks the moment the founder is offline.

Every alpha user is already invited via Clerk (signups are invitation-only). The extension binary itself isn't sensitive, but we don't want random visitors with the URL pulling unsigned zips off our infrastructure either — the link should be tied to a Clerk session so we can revoke an invitee's access if needed.

## Decision

CI builds, zips, and uploads the production extension on every release. The dashboard exposes a new authenticated page at `/app/download-extension` that surfaces a presigned download URL minted on each visit.

- New private R2 bucket `remarks-extension-builds` (prod) / `remarks-extension-builds-dev` (dev). Same access-key pair as the screenshots bucket — one-bucket-scope tokens get unwieldy fast.
- CI step in `.github/workflows/extension-release.yml` runs `pnpm zip` after the existing version-bump-and-tag pipeline, then uploads two keys via `tools/scripts/upload-extension-build.ts`:
  - `releases/chrome/remarks-chrome-<version>.zip` — immutable, never overwritten.
  - `releases/chrome/latest.json` — `{ version, sha256, sizeBytes, uploadedAt, key }`, overwritten each release.
- API endpoint `GET /v1/extension/latest` (Clerk-authed, mounted under the authenticated scope alongside `/projects/*`) reads `latest.json`, mints a 1-hour presigned GET URL for the keyed zip, and returns both. Same TTL as screenshots per ADR-0012.
- Dashboard page is a server component that fetches the endpoint on each visit, so every page load gets a fresh URL. Button label embeds the version (`Download Remarks v0.1.6 (.zip)`) so users know exactly what they're getting.
- Extension's own three-dot menu shows the running version (read from `chrome.runtime.getManifest()`) so users can compare and decide whether to redownload.

## Consequences

- Founder is no longer the bottleneck for alpha distribution.
- Friends-and-family soak gets real distribution data: how many people land on the page, how many actually install, how often they redownload after a release.
- Unpacked-install UX is still rough: no auto-update, users have to redownload + click reload in `chrome://extensions` for every release. Documented on the page; we accept the friction as the cost of skipping the Web Store review queue for now.
- Two artifact paths now exist (R2 zip + Web Store, eventually). When A8 lands the dashboard page should either redirect to the Web Store listing or surface both during a soak, then this ADR is superseded.
- The 1-hour TTL means a user who sits on the page for >1 hour and clicks gets a 403 on the URL. Documented on the page ("refresh if it stops working").
- Adds one more required env var (`R2_BUCKET_EXTENSION_BUILDS`) and four new GitHub Actions secrets (`EXTENSION_PROD_CLERK_*`, `EXTENSION_PROD_API_URL`, `EXTENSION_PROD_DASHBOARD_URL`) that must be populated pre-merge or the post-merge CI run fails.

## Alternatives considered

**Public R2 bucket on a custom domain** (e.g. `dl.remarks.online/remarks-chrome-latest.zip`) — simpler, no API roundtrip, but conflicts with the "no public buckets ever" stance from ADR-0012 and gives away the binary to anyone with the URL. Invitation-only signups are the whole reason the alpha is closed; leaking the binary undermines that.

**Keep the manual local-build flow until the Web Store listing is live** — fine if A8 lands soon, but Clerk's OAuth gaps (memory: `project_clerk_no_custom_scopes_yet`) and the spec-gaps backlog suggest that's not imminent. The founder shouldn't be in the loop for every alpha install.

**Publish via GitHub Releases instead of R2** — the zip would still be public, and we'd be coupling distribution to repo visibility. R2 keeps the binary in our infrastructure and lets us flip to public-bucket-with-custom-domain later without changing the upload path.
