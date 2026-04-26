// Surfaced in two places:
//   1. MCP `initialize` response → serverInfo.version (per the SDK).
//   2. `remarks_whoami.server_version` (Phase 2 spec §3.2).
//
// Phase 2 spec §3.1: "The MCP server exposes a version in the initialization
// response; breaking changes bump the server version (v1 → v2)." Bumped in
// task 2.29 (announcement / launch). Keep in sync with apps/mcp/package.json#version.
export const SERVER_VERSION = "0.0.0";
