# 0009. WXT for the browser extension

Date: 2026-04-21
Status: Accepted

## Context

The Remarks browser extension is the primary capture surface and needs to target Chrome (MV3) first and Firefox later, with React in the popup and sidebar, TypeScript across content scripts and the background service worker, and a hot-reload development loop that doesn't require manual rebuilds. Hand-rolled Webpack + MV3 configs are famously painful: content-script CSS injection, HMR across worker contexts, and cross-browser manifest shims each consume meaningful time. WXT is a Nuxt-inspired framework that abstracts this.

## Decision

Use **WXT** as the build and dev tooling for `apps/extension`. WXT handles Manifest V3 generation, hot-reload for content scripts and the background worker, React integration, and produces distributable zips for the Chrome Web Store and Firefox Add-ons in one build. The extension is written in TypeScript + React and shares UI primitives with the dashboard via `packages/ui`. The rectangle and element pickers, sidebar UI, and screenshot capture logic are ported from the existing Remarks extension into this new shell (see spec §6.8, §6.9).

## Consequences

Dev loop is a single `pnpm --filter @remarks/extension dev` command producing a loadable extension folder that reloads on save. Cross-browser builds are a single config change, not a parallel Webpack config. We're locked to WXT's conventions — file-based entry points, specific config shape — which is a small price for the time saved. WXT is a young project; we accept the risk that we may need to patch or fork it, and the extension code is portable to another build tool if necessary.

## Alternatives considered

**Plasmo** — similar in spirit to WXT, comparable DX, but heavier framework decisions baked in and a less active maintainer as of 2026. **CRXJS + Vite** — works but requires more hand-rolled MV3 plumbing. **Hand-rolled Webpack + webext-polyfill** — what the existing Remarks extension uses; we rejected this because the dev loop is slow and the config is opaque to Claude Code.
