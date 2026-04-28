import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Base64-encoded DER RSA public key. Commits are intentional: the public key
// is what makes the chrome-extension ID deterministic across all "Load
// unpacked" installs. Private key lives in `.keys/private.pem` (gitignored)
// and is only needed for packaging a .crx. Extension ID derived from this key:
// baikikfefeheiildmfoaicbjbnbecgjd
const CRX_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmWGCfSBP85Y/nn8NpjDVM5ck6HLG05dYM7ksaA2JVrqL+ytsa7tTWVfSqH54TiELn1dRizvg7mRc5H9DZjfRHATWHgQHxGhA/3nyo3xP6pvucuD194hV3IFKgDXdXD5s8mKkLfh+3IXS6iBj12D7zXAkN+dAe2HwzbCuxVZKjCmR3327FLGzG8j9XG/cGUgFfYN1wKClX+htssPGHe86ODcYU/iFTo996op0yjnmwYSvscundoqVPzh3S6DZW0N3v9sFiZx2QmoB+YZy8+8VED0U0BmvUNNXl8R9ikCdlKuCmtyuwkljlwLjQwRCGjTA1TpaM05upcda0foFk29qSQIDAQAB";

// Production builds (via `wxt build --mode production`) drop dev-only host
// matches so the Chrome Web Store reviewer doesn't see permissions the
// shipped extension never uses. WXT runs the config in Node, so reading
// process.env.NODE_ENV here is the trigger.
const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // Pin host to 127.0.0.1: Node 18+ binds the literal "localhost" to IPv6
  // only on macOS, but Chrome's WebSocket resolves to IPv4 → ERR_CONNECTION_REFUSED.
  // Pin port off 3000 to avoid the collision with `next dev -p 3000` (dashboard).
  dev: {
    server: {
      host: "127.0.0.1",
      port: 3030,
    },
  },
  // Don't auto-launch a Chromium window on `wxt` / `turbo run dev`. We load
  // the unpacked extension manually via chrome://extensions (see
  // docs/runbooks/local-dev.md), so the auto-opened about:blank is just noise.
  webExt: {
    disabled: true,
  },
  manifest: {
    name: "Remarks",
    description:
      "Pin comments, screenshots, and tasks to any webpage. Share feedback in context with your team.",
    homepage_url: "https://remarks.online",
    key: CRX_PUBLIC_KEY,
    permissions: ["storage", "activeTab", "tabs", "cookies"],
    host_permissions: [
      "<all_urls>",
      "https://app.remarks.online/*",
      "https://*.clerk.accounts.dev/*",
      "https://clerk.remarks.online/*",
      ...(isProd ? [] : ["http://localhost/*"]),
    ],
    // Lets the dashboard origin call `chrome.runtime.sendMessage(<id>, ...)`
    // to detect a successful install during onboarding (spec §7.5,
    // ADR 0014). Scoped to the dashboard origins only — narrowest matches
    // CLAUDE.md §12 ("minimum needed").
    externally_connectable: {
      matches: [
        "https://app.remarks.online/*",
        ...(isProd ? [] : ["http://localhost:3000/*"]),
      ],
    },
    action: {
      default_title: "Remarks",
    },
  },
});
