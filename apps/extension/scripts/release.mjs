#!/usr/bin/env node
// Bump the extension's semver version, then optionally build + zip a
// store-ready package. Source of truth for version is apps/extension/package.json
// — WXT reads it at build time. See docs/store/chrome-web-store.md for the
// surrounding submission flow.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(__dirname, "..", "package.json");

const FLAGS = new Set(process.argv.slice(2));
const bumpKind = FLAGS.has("--major")
  ? "major"
  : FLAGS.has("--minor")
    ? "minor"
    : "patch";
const dryRun = FLAGS.has("--dry-run");
const skipBuild = FLAGS.has("--skip-build");

function bump(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`unsupported version "${version}"; expected MAJOR.MINOR.PATCH`);
  }
  let [, major, minor, patch] = match.map(Number);
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const pkgRaw = readFileSync(PKG_PATH, "utf8");
const pkg = JSON.parse(pkgRaw);
const oldVersion = pkg.version;
const newVersion = bump(oldVersion, bumpKind);

console.log(`extension: ${oldVersion} → ${newVersion} (${bumpKind})`);

if (dryRun) {
  console.log("dry run; no files written");
  process.exit(0);
}

// Preserve trailing newline; rewrite version field only.
const updated = pkgRaw.replace(
  /("version"\s*:\s*")[^"]+(")/,
  `$1${newVersion}$2`,
);
writeFileSync(PKG_PATH, updated);
console.log(`wrote ${PKG_PATH}`);

if (skipBuild) {
  console.log("--skip-build: skipping build + zip");
  printNextSteps(newVersion);
  process.exit(0);
}

const cwd = join(__dirname, "..");
function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

run("pnpm build:prod");
run("pnpm zip");

printNextSteps(newVersion);

function printNextSteps(version) {
  const tag = `extension-v${version}`;
  console.log("");
  console.log("next steps:");
  console.log(`  1. inspect .output/<name>-${version}-chrome.zip`);
  console.log(`  2. tag the release:    git tag ${tag}`);
  console.log(`  3. push the tag:       git push origin ${tag}`);
  console.log("  4. upload the zip via https://chrome.google.com/webstore/devconsole");
  console.log("     (paste from docs/store/chrome-web-store.md into the listing/privacy tabs)");
}
