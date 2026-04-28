# Chrome Web Store: Remarks listing

This is the source document for the Chrome Web Store listing and Privacy tab.
Every field below maps to a single field in the developer dashboard at
https://chrome.google.com/webstore/devconsole. Copy each block verbatim into
the corresponding form field.

Maintain this file alongside any manifest change — when permissions or data
collection shift, update the relevant section here in the same PR. The
reviewer cross-checks the manifest against the Privacy tab disclosures.

---

## 1. Release process

The version bump and tag are automated. The build, zip, and upload to the
store are manual — they need production Clerk credentials that live in the
developer's local `.env.production`, not in GitHub Actions secrets.

### 1.1 Automated: version bump + tag (CI)

`.github/workflows/extension-release.yml` runs on every push to `main` that
touches `apps/extension/**`. It:

1. Detects whether the merge commit already changed the `version` field in
   `apps/extension/package.json` (manual minor/major bumps in the PR).
2. If not, runs `pnpm --filter @remarks/extension release -- --patch
   --skip-build` to bump the patch version and commit the change back to
   `main` as `chore(extension): release v<version> [skip ci]`.
3. Tags the commit `extension-v<version>` and pushes the tag.
4. Writes the local-build commands into the run summary so the developer
   has them at hand.

CI does **not** build or zip — that's the manual half of the flow.

To override the auto-patch (e.g., for a minor or major release), bump
`apps/extension/package.json` `version` manually in the PR. The workflow
detects the delta and skips the auto-bump but still tags.

### 1.2 Manual: build, zip, upload (developer)

After CI tags the release, the developer who's submitting to the Chrome
Web Store does the rest from their machine. Prereq: `apps/extension/.env.production`
exists locally with `pk_live_…` Clerk creds (see `apps/extension/.env.example`
lines 23–43 for the exact shape and the one-time `clerk-allowlist-extension.ts`
allowlist step).

```bash
# Pull the tagged release
git fetch --tags
git checkout extension-v<version>
pnpm install --frozen-lockfile

# Build + zip with production env
pnpm --filter @remarks/extension build:prod
pnpm --filter @remarks/extension zip
# → apps/extension/.output/<name>-<version>-chrome.zip
```

Smoke-test the zip locally before uploading — saves a re-submission
round-trip if the build broke something user-visible:

```
chrome://extensions → Developer mode ON → Load unpacked
→ apps/extension/.output/chrome-mv3/
→ click the Remarks icon → Sign in → sidebar mounts on a fresh tab
→ capture an annotation → confirm it round-trips to api.remarks.online
```

Manifest spot-check before upload (open the zip's `manifest.json` directly):

- `manifest_version: 3`
- `version` matches the tag
- No `scripting` permission
- No `localhost` host patterns
- `homepage_url` present
- `https://clerk.remarks.online/*` in `host_permissions`

Then upload at https://chrome.google.com/webstore/devconsole. Drag-and-drop
the zip into the dashboard's "Package" tab; don't try to script the upload
(the dashboard is the source of truth and rejects tampered submissions).

### 1.3 Pre-submission gate

The first time you submit, confirm all of the following before clicking
"Submit for review":

- [ ] Tag exists: `extension-v<version>` is pushed to `origin`.
- [ ] Zip in hand: `apps/extension/.output/<name>-<version>-chrome.zip` was
      produced from a clean `git checkout extension-v<version>` (no
      uncommitted changes — easy to ship a hot-patch by accident).
- [ ] Manifest spot-check passes (above).
- [ ] Smoke test passes against the production Clerk + API (above).
- [ ] Privacy policy live at `https://app.remarks.online/privacy`.
- [ ] Developer-account 2-Step Verification on (CWS requires this to
      publish).
- [ ] $5 one-time developer registration fee paid (first-time only).
- [ ] Listing tab fields below copy-pasted from §2.
- [ ] Privacy tab fields below copy-pasted from §3.
- [ ] All five screenshots uploaded; small promo tile uploaded; marquee
      uploaded if available.

---

## 2. Listing tab

### Item title

```
Remarks
```

### Item summary (≤132 characters)

96 chars; mirrors the manifest description so reviewer cross-checks pass.

```
Pin comments, screenshots, and tasks to any webpage. Share feedback in context with your team.
```

### Item description

Overview paragraph + feature list + what-it's-not. Plain text, no HTML, no
keyword stuffing.

```
Remarks turns any webpage into a surface for in-context feedback. Open the
sidebar on any URL, point at the part of the page you want to talk about,
and leave a comment. Your teammates see the same annotation pinned to the
same spot — even on staging, even behind auth, even mid-flow.

Made for product, design, and engineering teams who are tired of "see the
attached screenshot" feedback loops.

Features:
• Sidebar that mounts on any page and stays out of your way (drag to dock
  left, right, or bottom; collapse with a keyboard shortcut)
• Element picker — click any DOM node to attach a comment to it; we capture
  the selector, surrounding text, and a cropped screenshot
• Region picker — drag a rectangle anywhere on the page to capture exactly
  what you want to talk about
• Personal scope — start annotating without an organization; share later
• Project scope — assign annotations to a project so the right team sees
  them in their dashboard inbox
• Status workflow — open / in progress / resolved, with a thread of replies
  on every annotation
• Offline-friendly — captures queue locally and upload when you reconnect
• MCP integration — agents (Claude, Cursor, Windsurf) can list, read, and
  resolve annotations alongside you

What Remarks is not:
• A bug tracker (use Linear or Jira; Remarks is the front door, not the
  system of record)
• An analytics or session-replay tool (we never record anything you don't
  explicitly capture)
• A page-modification tool (Remarks reads the page; it never injects
  scripts into your site or alters the DOM you're annotating)

Privacy: Remarks only captures data when you explicitly point at something
or draw a region. We don't read pages in the background, don't follow you
between sites, and don't sell or share your data. Full policy:
https://app.remarks.online/privacy
```

### Category

```
Productivity
```

(Secondary fit: Developer Tools. Productivity is the better top-level
category — Remarks is used by designers and PMs as much as engineers.)

### Language

```
English (United States)
```

### Store icon

`apps/extension/public/icon/128.png` — already shipped at the right size.

### Screenshots (1280 × 800 px, square corners, full bleed)

5 screenshots; minimum 1, recommended up to 5. The first screenshot is the
hero — it's what users see in search results and on the listing card before
they click in. Make that one count.

| # | Caption                                              | Frame                                                          |
| - | ---------------------------------------------------- | -------------------------------------------------------------- |
| 1 | "The sidebar mounts on any page."                    | A real article page with the sidebar docked right, one open annotation pinned to a paragraph. |
| 2 | "Point at any element to attach a comment."          | Element-pick mode active, hovering a button; show the selector preview at the bottom of the sidebar. |
| 3 | "Or draw a region — exactly what you want to talk about." | Mid-drag of the rectangle picker; the cropped preview visible in the sidebar capture panel. |
| 4 | "Add context, pick a project, ship it."              | Capture popover open with a comment typed and the project picker visible. |
| 5 | "Track status. Resolve threads. Move on."            | Sidebar thread list with mixed open/resolved annotations and the status filter visible. |

#### Hard requirements (Chrome Web Store)

- **Exact dimensions:** 1280×800 px (preferred) or 640×400 px. Don't
  upscale a 640 image to 1280 — the dashboard accepts both, but 1280 is
  what the listing page actually renders, so deliver native 1280.
- **Aspect ratio:** 16:10. Anything else gets letterboxed in the listing.
- **Format:** PNG or 24-bit JPEG. PNG preferred — sharper text rendering.
- **Square corners, full bleed.** No rounded corners, no drop shadows, no
  padding, no decorative borders. The image fills the frame edge to edge.
- **Maximum file size:** 5 MB per screenshot.

#### How to capture

The extension renders inside a shadow root, so you can't use the
browser's "screenshot full page" feature alone — it captures the host
page but not the sidebar overlay. Two reliable options:

1. **macOS native (Cmd+Shift+4 → space → click window):** captures the
   visible viewport including extension UI. Then crop / pad to 1280×800
   in any image editor. Use the system-default 2× retina display for
   sharper output, then downscale to 1280×800.
2. **Chrome DevTools "Capture screenshot":** open DevTools → Cmd+Shift+P
   → "Capture screenshot". Captures the rendered viewport including
   extension shadow content. Set device toolbar to 1280×800 or 1440×900
   first.

A 1440×900 capture downscaled to 1280×800 looks cleaner than a native
1280×800 screenshot — small text antialiases better on the downscale.

#### Content rules (what reviewers reject)

- **No lorem ipsum or placeholder text in annotations.** Reviewers
  routinely flag listings that show fake content. Use real-looking
  prose — a sentence about the page being annotated.
- **No competitor logos or screenshots of competitor products.** Don't
  capture against Linear, Notion, Figma, etc.
- **No personal data visible.** Blur or replace any real email
  addresses, names, profile photos, or org names that aren't yours.
- **No browser chrome (URL bar, tabs).** Crop to just the page content
  + extension UI, or use a clean Chrome profile with no bookmark bar /
  no extra tabs.
- **No "as seen in TechCrunch" / "Editor's Choice" / "#1 Productivity
  Tool" claims.** Even in caption text overlay.
- **Avoid superlatives in caption text.** "The fastest way…" / "The
  best…" — write what the screenshot shows, not how great it is.

#### Quality bar

- **Text legibility at thumbnail size.** The listing card shrinks the
  hero to ~320×200. If the caption isn't readable at that size, rewrite
  it shorter or larger.
- **One idea per screenshot.** Don't show the picker, sidebar, popover,
  and thread list all in one frame — pick the dominant element and let
  the others fall into the background.
- **Consistent visual treatment across the 5.** Same browser zoom,
  same sample webpage, same color scheme. Don't mix light-mode and
  dark-mode screenshots unless that's the point being made.
- **Captions in the same place each frame.** Top-center or
  bottom-center, same font, same weight.

### Small promo tile (440 × 280 px) — optional but recommended

Shown on the Chrome Web Store category and search pages. Without it the
listing relies entirely on the hero screenshot, which gets cropped
oddly in tile contexts. Strongly recommended.

#### Hard requirements

- **Exact dimensions:** 440×280 px (5:3 aspect ratio).
- **Format:** PNG or 24-bit JPEG. PNG for crisp text.
- **Maximum file size:** 5 MB.
- **Square corners, full bleed.**

#### Design brief

- **Brand-forward, not screenshot-forward.** UI screenshots inside a
  440×280 tile shrink to ~220×140 in many contexts — UI text becomes
  unreadable. Lead with the wordmark + tagline; if you include a UI
  element, make it a single recognizable shape (e.g., the sidebar
  silhouette), not a literal screenshot.
- **Background:** a saturated brand color (Remarks dark
  charcoal/indigo) or a subtle gradient. Avoid white — washes out
  against the store's white background.
- **Wordmark:** "Remarks" left-aligned, ~30% of the tile width, white
  or near-white type.
- **Tagline:** one short line, max ~6 words. "In-context feedback for
  the web." Below or beside the wordmark.
- **No CTAs.** No "Install Now" / "Try Free" buttons — Chrome adds
  install affordances itself, and adding your own is a common rejection
  reason.
- **No award badges, no third-party logos.**

### Marquee image (1400 × 560 px) — optional, only shown when featured

The marquee only appears on the listing if Google promotes the
extension on the Chrome Web Store homepage or in a curated collection.
Treat it as nice-to-have for launch, not a blocker. If the design team
has bandwidth, ship it; if not, leave the field blank.

#### Hard requirements

- **Exact dimensions:** 1400×560 px (5:2 aspect ratio).
- **Format:** PNG or 24-bit JPEG.
- **Maximum file size:** 5 MB.
- **Square corners, full bleed.**

#### Design brief

- **Hero composition:** product screenshot left-anchored at ~60% of the
  tile width, with title + tagline + supporting text on the right
  third. Or reverse for right-anchored. Don't center — the listing UI
  often crops the marquee horizontally.
- **Slight perspective or angle on the screenshot** (e.g., 5° tilt or
  a faint browser-frame mockup) reads more "feature graphic" than
  "raw screenshot."
- **Text overlay:** title in 60–80 px type, tagline in 28–36 px, both
  in the brand sans-serif. Maximum ~10 words total.
- **Color palette matches the small promo tile.** A user who saw the
  tile and clicks through should see consistent branding.
- **Same content rules as the screenshots.** Real annotations, no
  competitor screens, no superlatives, no award claims.

### Where to put deliverables

When the design team produces these assets, drop them in
`docs/store/assets/` (gitignored — they're large binary files that
shouldn't bloat the repo). Naming convention:

```
docs/store/assets/
  icon-128.png                     ← already in apps/extension/public/icon/128.png
  screenshot-01-sidebar.png        ← 1280×800, hero
  screenshot-02-element-picker.png ← 1280×800
  screenshot-03-rect-picker.png    ← 1280×800
  screenshot-04-capture-popover.png ← 1280×800
  screenshot-05-thread-list.png    ← 1280×800
  promo-tile-440x280.png
  marquee-1400x560.png             ← optional
```

The CWS dashboard accepts uploads via drag-and-drop; don't try to
script the upload — the dashboard is the source of truth and bypasses
common scripting attempts to detect tampered submissions.

### Website / homepage URL

```
https://remarks.online
```

### Support URL

```
https://remarks.online/support
```

> If `/support` is not yet live at submission time, leave the field blank
> rather than pointing at a 404. CWS allows the field to be empty.

---

## 3. Privacy tab

### Single purpose description

```
Remarks lets users pin in-context comments, screenshots, and tasks to any
webpage so teams can give feedback where it matters. Every feature in the
extension serves this one purpose.
```

### Permission justifications

One block per permission declared in the manifest. Concise, names the
feature and why a narrower permission won't work.

**`storage`**
```
Persist user preferences (sidebar dock position, width, compact mode), the
currently selected project per organization, the active Clerk organization,
and the offline-capture outbox in chrome.storage.local. Without this, users
would re-configure their workspace on every page reload and lose unsent
captures on browser restart.
```

**`activeTab`**
```
Capture a PNG of the current tab when the user explicitly invokes the
element picker or rectangle picker. We call chrome.tabs.captureVisibleTab
only in response to a user gesture (keyboard shortcut or sidebar button).
We do not poll, capture in the background, or capture without an explicit
user action.
```

**`tabs`**
```
Open the dashboard's sign-in and sign-up pages in a new tab when the user
clicks "Sign in" or "Create account" in the popup. We use
chrome.tabs.create with our own dashboard URL (https://app.remarks.online)
exclusively; we do not enumerate, query, or interact with the user's other
tabs.
```

**`cookies`**
```
Monitor the Clerk session cookie on https://app.remarks.online and
https://clerk.remarks.online so the extension's authentication state stays
in sync with the dashboard. When the user signs in or out of the dashboard,
the extension's sidebar updates without requiring a separate sign-in flow.
We never read or write cookies on any other origin.
```

### Host permission justifications

One block per pattern in `host_permissions` (production manifest only).

**`<all_urls>`**
```
The sidebar is the extension's primary interface, and a teammate may want
to leave feedback on any URL — production sites, staging, internal tools,
intranet pages. Restricting <all_urls> to an allowlist would break the
extension for the majority of legitimate uses. The sidebar is hidden by
default (toggled by user gesture) and reads no page content unless the
user explicitly invokes the element picker or rectangle picker.
```

**`https://app.remarks.online/*`**
```
The Remarks dashboard origin. Used for two things: (1) opening the
sign-in and sign-up flows in a new tab, (2) accepting an
externally_connectable message from the dashboard during onboarding so the
dashboard can confirm the extension installed successfully (ADR 0014).
```

**`https://*.clerk.accounts.dev/*`**
```
Clerk's Frontend API domain for development Clerk instances. Required by
@clerk/chrome-extension to read the user's session state. Only relevant in
development; production traffic goes through clerk.remarks.online (below).
```

**`https://clerk.remarks.online/*`**
```
Clerk's Frontend API domain for our production Clerk instance. Required by
@clerk/chrome-extension to read the user's session state in production.
```

### Remote code

```
No, I am not using remote code.
```

The extension bundles all JavaScript, WASM, and CSS into the package at
build time. We do not load remote scripts, evaluate strings as code, or
import scripts from external URLs at runtime.

### Data usage — what is collected

Tick the boxes below; explanation goes in the box that appears under each.

- [x] **Personally identifiable information** —
      Email address and name from the user's Clerk profile (provided when
      the user signs in or up). Used to identify the author of an
      annotation. Not sold or shared with third parties.

- [x] **Authentication information** —
      Clerk session token, stored in chrome.storage and on the Clerk
      session cookie. Used solely to authenticate API requests to
      api.remarks.online.

- [x] **Website content** —
      When the user explicitly invokes a capture: a cropped screenshot of
      the visible tab region the user selected; the CSS selector of the
      picked DOM element; the selected element's tag name, classes, and
      visible text. Stored on Cloudflare R2 (screenshots) and our Postgres
      database (metadata).

- [x] **Web history** —
      The URL of the page on which the user creates an annotation. Stored
      with the annotation so the sidebar can re-display it when the user
      returns to that URL. We do not record URLs of pages the user simply
      visits without annotating.

- [x] **User activity** —
      Annotation creation events (taps inside the extension's own UI),
      used for product analytics. No third-party analytics SDKs are
      bundled in the extension.

NOT collected (do **not** tick these):

- Financial and payment information
- Health information
- Personal communications
- Location
- Generalized web browsing history (we collect URLs only when the user
  creates an annotation on that page)

### Limited Use certifications

All three certifications below must be true at the time of submission.
Verify the dashboard's exact wording and tick each box.

1. **Compliance** — The use of information received from Google APIs will
   adhere to the Chrome Web Store User Data Policy, including the Limited
   Use requirements.

2. **No advertising use** — We do not use or transfer user data for
   serving ads, including retargeted, personalized, or interest-based
   advertising.

3. **No unauthorized transfer** — We do not transfer user data to third
   parties for purposes unrelated to the user-visible features of
   Remarks. Subprocessors (Clerk, Cloudflare R2, Neon, Fly.io, Vercel) are
   bound by DPAs and process data only on Remarks' behalf.

### Privacy policy URL

```
https://app.remarks.online/privacy
```

> The marketing alias `https://remarks.online/privacy` is a follow-up
> Vercel rewrite. Use the `app.` URL at submission time — it resolves
> directly via the dashboard `/privacy` route.

---

## 4. Asset specs (production)

Design-team brief. Exact pixel dimensions:

| Asset           | Dimensions   | Quantity            | Source / status                              |
| --------------- | ------------ | ------------------- | -------------------------------------------- |
| Store icon      | 128 × 128 px | 1                   | `apps/extension/public/icon/128.png` ✓ shipped |
| Screenshots     | 1280 × 800 px | 5 (1 min, 5 max)   | New — see frame brief in §2                  |
| Small promo tile | 440 × 280 px | 1                   | New — design brief in §2                     |
| Marquee         | 1400 × 560 px | 1                   | New — optional, only shown when featured     |

Constraints (from CWS Best Listing guidance):

- Square corners, full bleed (no padding) on screenshots.
- Saturated colors, legible at half size on promo art.
- Minimal text overlay on promo art.
- No "Editor's Choice" / "Number One" / superlative claims.
- No competitor screenshots or logos.

---

## 5. Post-submission

- **Review window:** typically 1–3 business days for first-time submissions;
  can stretch to a week if the reviewer flags a permission. Plan around it.
- **What triggers re-review:** any change to the manifest (permissions,
  host_permissions, content_scripts), description, screenshots, or the
  privacy disclosures. Bug-fix-only zips with no manifest delta sometimes
  publish without re-review, but treat re-review as the default expectation.
- **Versioning rule:** every uploaded zip must have a higher `version` than
  the previous upload. The release script + CI workflow at
  `.github/workflows/extension-release.yml` enforces monotonic patch bumps;
  manual minor/major bumps in a PR override the auto-bump.
- **If rejected:** the dashboard email lists the violated policy. Read it
  carefully — most rejections are a permission justification that didn't
  match the actual code path. Fix the code or the disclosure (whichever is
  out of sync), bump the version, re-upload, refer back to this doc.
