#!/usr/bin/env node
/**
 * Wrapper around `wxt prepare` that force-exits after types are generated.
 *
 * WXT 0.20.25's `prepare` command logs "✔ Finished in NNN ms" once type
 * generation completes, but its Node process doesn't exit — a kqueue/epoll
 * handle leak. Locally that stalls `pnpm install`'s postinstall and CI's
 * typecheck step indefinitely. Polling for `.wxt/wxt.d.ts` and killing the
 * child once the file materializes is the narrow fix that matches what the
 * downstream consumer (tsc --noEmit) actually needs.
 */
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const TYPES_FILE = path.resolve(__dirname, "..", ".wxt", "wxt.d.ts");
const MAX_MS = 60_000;
const GRACE_MS = 300; // let wxt finish its final log flush after types land.
const POLL_MS = 150;

// Resolve the wxt binary directly from this package's node_modules so we
// don't depend on PATH inheritance. Works across pnpm's strict-linker and
// hoisted layouts.
const WXT_BIN = path.resolve(__dirname, "..", "node_modules", ".bin", "wxt");
const child = spawn(WXT_BIN, ["prepare"], { stdio: "inherit", shell: false });
const started = Date.now();

const poll = setInterval(() => {
  if (existsSync(TYPES_FILE)) {
    clearInterval(poll);
    setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500);
    }, GRACE_MS);
    return;
  }
  if (Date.now() - started > MAX_MS) {
    clearInterval(poll);
    console.error("wxt prepare did not produce .wxt/wxt.d.ts within 60s");
    child.kill("SIGKILL");
    process.exit(1);
  }
}, POLL_MS);

child.on("exit", (code, signal) => {
  clearInterval(poll);
  // SIGTERM/SIGKILL means we killed it after types were generated — success.
  if (signal === "SIGTERM" || signal === "SIGKILL") process.exit(0);
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  clearInterval(poll);
  console.error("failed to start wxt:", err);
  process.exit(1);
});
