#!/usr/bin/env node
/**
 * Wrapper around `wxt <subcommand>` (`prepare` or `build`) that force-exits
 * after wxt logs "Finished in …".
 *
 * wxt 0.20.25 has a handle leak (kqueue on macOS, epoll in Linux CI) that
 * prevents its Node process from exiting after the subcommand logically
 * completes. Locally this looked like postinstall hanging; in CI it stalls
 * the build step indefinitely after wxt's final log line.
 *
 * Usage:
 *   node scripts/prepare-with-exit.cjs prepare
 *   node scripts/prepare-with-exit.cjs build [extra-wxt-args...]
 *
 * Strategy: spawn wxt with stdio piped, tee its output to the parent, and
 * watch for the "Finished in" line. Once seen, wait a short grace period
 * and SIGTERM → SIGKILL the child. Exits with wxt's code on natural exit or
 * 0 after a forced kill.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error("usage: prepare-with-exit.cjs <subcommand> [...args]");
  process.exit(2);
}

const WXT_BIN = path.resolve(__dirname, "..", "node_modules", ".bin", "wxt");
const MAX_MS = 300_000; // 5 min ceiling — builds can be slow on CI
const GRACE_MS = 400; // let wxt flush anything after "Finished in".

const child = spawn(WXT_BIN, argv, { stdio: ["inherit", "pipe", "pipe"], shell: false });
let finishedSeen = false;
let killScheduled = false;
let exited = false;
let exitCode = 0;
const started = Date.now();

function killAndExit() {
  if (killScheduled) return;
  killScheduled = true;
  setTimeout(() => {
    if (exited) return;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 500);
  }, GRACE_MS);
}

function teeAndWatch(stream, downstream) {
  stream.on("data", (chunk) => {
    downstream.write(chunk);
    if (finishedSeen) return;
    const text = chunk.toString("utf8");
    // Match wxt's success line: "✔ Finished in NNN ms". Fall back to any
    // line containing the ASCII "Finished in" to survive minor formatting
    // changes.
    if (text.includes("Finished in")) {
      finishedSeen = true;
      killAndExit();
    }
  });
}

teeAndWatch(child.stdout, process.stdout);
teeAndWatch(child.stderr, process.stderr);

const watchdog = setInterval(() => {
  if (Date.now() - started > MAX_MS) {
    console.error(`wxt ${argv[0]} exceeded ${MAX_MS}ms without finishing`);
    clearInterval(watchdog);
    child.kill("SIGKILL");
    process.exit(1);
  }
}, 2000);

child.on("exit", (code, signal) => {
  exited = true;
  clearInterval(watchdog);
  // If we initiated the kill after seeing "Finished in", treat it as success.
  if (finishedSeen && (signal === "SIGTERM" || signal === "SIGKILL")) {
    process.exit(0);
  }
  exitCode = code ?? 0;
  process.exit(exitCode);
});

child.on("error", (err) => {
  clearInterval(watchdog);
  console.error("failed to start wxt:", err);
  process.exit(1);
});
