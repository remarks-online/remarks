# Extension distribution (alpha, via R2)

The Remarks Chrome extension isn't on the Chrome Web Store yet (spec-gap A8).
Until it lands, alpha testers download a signed zip from
`/app/download-extension` after signing into the dashboard. This runbook
covers the moving pieces and the fix-it paths when something drifts.

See **ADR-0017** for the why. This doc is the operational playbook.

---

## What's where

- **Bucket:** `remarks-extension-builds` (prod) and `remarks-extension-builds-dev` (dev).
  CI integration tests use `remarks-extension-builds-test` against MinIO.
- **Keys** (under both buckets):
  - `releases/chrome/remarks-chrome-<version>.zip` — immutable per version.
  - `releases/chrome/latest.json` — pointer; overwritten on every release.
- **Retention**: nothing prunes old versioned zips. Every release adds one key; none are deleted. Storage cost is negligible (~5 MB per release, R2's free tier is 10 GB) and keeping them preserves the rollback path below. Add a Cloudflare R2 Object Lifecycle rule on `releases/chrome/` if you ever want a hard cap — recommend ≥90 days so rollback stays useful.
- **Manifest shape (`latest.json`):**
  ```json
  { "version": "0.1.7", "sha256": "...64hex...", "sizeBytes": 1234567,
    "uploadedAt": "2026-05-01T12:34:56.000Z",
    "key": "releases/chrome/remarks-chrome-0.1.7.zip" }
  ```
- **API endpoint:** `GET /v1/extension/latest` (Clerk-authed) on `apps/api`.
  Returns the manifest fields plus a 1-hour presigned `downloadUrl`.
- **Dashboard:** `/app/download-extension` server-renders the metadata into
  the "Download Remarks v\<version\> (.zip)" button.
- **Upload script:** `tools/scripts/upload-extension-build.ts`, invoked by
  `.github/workflows/extension-release.yml`.

## Required secrets and env

### GitHub Actions secrets (set on the repo)

| Secret | Purpose |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account hosting the bucket |
| `R2_ACCESS_KEY_ID` | Bucket-scoped access key with read+write |
| `R2_SECRET_ACCESS_KEY` | …secret half of the above |
| `R2_BUCKET_EXTENSION_BUILDS` | `remarks-extension-builds` |
| `EXTENSION_PROD_CLERK_PUBLISHABLE_KEY` | `pk_live_…` from prod Clerk instance |
| `EXTENSION_PROD_CLERK_SYNC_HOST` | `https://clerk.remarks.online` |
| `EXTENSION_PROD_API_URL` | `https://api.remarks.online` |
| `EXTENSION_PROD_DASHBOARD_URL` | `https://app.remarks.online` |

Set these **before merging** any PR that requires them. The `extension-release`
workflow runs on push to `main` touching `apps/extension/**`; missing secrets
mean the next merge crash-loops the workflow.

### Fly secrets (`remarks-api`)

```sh
fly secrets set -a remarks-api R2_BUCKET_EXTENSION_BUILDS=remarks-extension-builds
```

The R2 access keys are already set for the screenshots flow — same key has
account-wide scope, so it can write the new bucket without rotation.

## First-time bucket provisioning

```sh
# Cloudflare dashboard → R2 → Create bucket → name `remarks-extension-builds`
# Repeat with `remarks-extension-builds-dev` if you want a separate dev bucket.
# No public access. Standard storage class. Default region.
```

No CORS rules needed: the dashboard never hits R2 directly — only the API
mints presigned URLs and the user's browser fetches them.

## Manually triggering a re-upload

If a release shipped but the upload step failed (e.g., R2 outage), or the
manifest got corrupted:

```sh
# From a clean checkout of the tagged release
git fetch --tags && git checkout extension-v<version>
pnpm install --frozen-lockfile
pnpm --filter @remarks/extension build:prod
pnpm --filter @remarks/extension zip

# Set the same env vars CI uses (see above)
export EXTENSION_VERSION=<version>
export EXTENSION_ZIP_PATH=apps/extension/.output/remarks-<version>-chrome.zip
export R2_ACCOUNT_ID=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_BUCKET_EXTENSION_BUILDS=remarks-extension-builds

pnpm --filter @remarks/scripts upload-extension-build
```

The script is idempotent — re-running with the same version overwrites the
zip key (R2 has no immutability guarantee here) and the manifest.

## Rolling back to a previous version

The zip keys are versioned and never deleted by the workflow, so rollback is
a one-key swap:

```sh
# Option 1: use AWS CLI with R2 endpoint
aws s3 cp \
  s3://remarks-extension-builds/releases/chrome/remarks-chrome-0.1.5.zip \
  /tmp/rollback.zip \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com

# Then build a new latest.json by hand pointing at the older key, and PUT it
# to releases/chrome/latest.json with content-type application/json.
```

Easier path: cut a new patch release from the prior commit (e.g., revert the
broken commit, push, let CI build a `0.1.7` from `0.1.5`'s tree). The
"manifest hand-edit" path is the fallback when CI is wedged.

## Drift recovery: manifest and zip out of sync

Symptom: `/app/download-extension` shows version X but the download 404s,
or downloads the wrong bytes.

1. Read the manifest:
   ```sh
   curl -s "https://app.remarks.online/api/extension/latest" \
     -H "Authorization: Bearer <your-clerk-token>" | jq .
   ```
   (Or sign into the dashboard and inspect the network tab.)
2. Check the keyed zip exists and matches the sha256:
   ```sh
   aws s3api head-object --bucket remarks-extension-builds \
     --key releases/chrome/remarks-chrome-X.Y.Z.zip \
     --endpoint-url https://<account-id>.r2.cloudflarestorage.com
   ```
3. If the key is missing → re-run "manually triggering a re-upload" above.
4. If the sha256 in the manifest doesn't match the zip's actual sha256 →
   rerun the upload (the script writes both atomically; one stuck would
   indicate the script crashed mid-upload).

## Why a 1-hour presigned URL?

Same TTL as the screenshots flow (ADR-0012). The URL is freshly minted on
**every visit** to `/app/download-extension` — the TTL only bounds how long
one specific minted URL stays valid, not when downloads are allowed. A user
who sits on the page for >1 hour and clicks gets a 403; documented on the
page as "refresh if the link stops working."

If the founder gets enough complaints, bump `PRESIGNED_TTL_SECONDS` in
`apps/api/src/routes/extension/latest.ts`. The R2 cap is 7 days.

## When the Web Store listing lands (A8)

- Decide whether the alpha download path stays as a fallback or sunsets.
- If sunset: redirect `/app/download-extension` to the CWS listing URL,
  delete the dashboard page in a follow-up.
- If fallback: keep it for users who can't install from CWS for whatever
  reason (corp-managed Chrome, etc.). The CI upload path is cheap to keep.
- Either way, this runbook becomes mostly historical — keep it for the
  rollback recipes.
