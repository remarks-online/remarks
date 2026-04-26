import { createHmac } from "node:crypto";

// HMAC-SHA256(plaintext, salt) → lowercase hex. Used by the MCP auth plugin
// to turn an inbound bearer into the value stored in
// project_api_tokens.token_hash. The salt must match the value the API uses
// when it creates tokens (task 2.20) — Phase 2 spec §5.1.
//
// Lives in apps/mcp because packages/shared is consumed by the browser
// extension and stays Node-types-free. Promote to packages/shared when the
// API's token-creation flow needs to hash too.
export function hashApiToken(plaintext: string, salt: string): string {
  return createHmac("sha256", salt).update(plaintext).digest("hex");
}
