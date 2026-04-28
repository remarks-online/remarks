# Extension release scripts

The end-to-end Chrome Web Store release process — automated bump/tag, manual
build/zip/upload — is documented in [`docs/store/chrome-web-store.md` §1](../../../docs/store/chrome-web-store.md).
This file just documents the local script invocations.

## `release.mjs`

Bumps `apps/extension/package.json` `version`. Optionally builds + zips a
store-ready package at
`apps/extension/.output/<name>-<version>-chrome.zip`.

```bash
# Patch bump (default), build, zip
pnpm --filter @remarks/extension release

# Minor or major bump
pnpm --filter @remarks/extension release -- --minor
pnpm --filter @remarks/extension release -- --major

# Preview the bump without writing files
pnpm --filter @remarks/extension release -- --dry-run

# Bump only — skip the build + zip (used by CI's auto-patch step)
pnpm --filter @remarks/extension release -- --skip-build
```

The script does not push, tag, or upload. CI handles tag/push for the
automated patch bumps; the developer doing the manual build also handles
upload.
