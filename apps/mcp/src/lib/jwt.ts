import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../env.js";
import { clerkIssuerFromPublishableKey } from "./clerk-issuer.js";

// JWT verifier for Clerk-issued OAuth access tokens (ADR-0015). Uses jose
// directly against Clerk's JWKS — `@clerk/backend`'s `verifyToken()` is built
// for Clerk *session* JWTs (`typ: "JWT"`) and rejects RFC 9068 OAuth access
// tokens (`typ: "at+jwt"`), which is what Clerk's OAuth provider issues.
// Verifies signature, issuer, audience (RFC 8707), and standard expiry/nbf.

// Lazy so module load doesn't try to parse the issuer URL — keeps tests with
// stub publishable keys importable without hitting `new URL()` until a real
// verification runs.
let cached: { issuer: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;
function getVerifierConfig(): { issuer: string; jwks: ReturnType<typeof createRemoteJWKSet> } {
  if (cached !== null) return cached;
  const issuer = clerkIssuerFromPublishableKey();
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  cached = { issuer, jwks };
  return cached;
}

export interface VerifiedToken {
  clerkUserId: string;
  scopes: string[];
  oauthClientName: string;
}

interface ClerkOAuthClaims extends JWTPayload {
  scope?: string;
  scopes?: string[];
  // Clerk's OAuth provider issues tokens with the OAuth client name in
  // `client_name`; some providers use `azp` (authorized party) and `client_id`.
  client_name?: string;
  azp?: string;
  client_id?: string;
}

function audienceContains(aud: string | string[], expected: string): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
}

// TODO(clerk-custom-scopes): remove the REMARKS_SCOPES fallback once Clerk
// ships custom OAuth scopes (currently roadmap-only — see
// docs/plan/spec-gaps.md A20). Until then, Clerk-issued tokens carry only
// built-in scopes (`openid` etc.) so we grant the Remarks scope set
// implicitly on any verified Clerk token. Per-tool requireScope() still
// gates from there.
const REMARKS_SCOPES = ["tasks:read", "tasks:write", "project:read"];

function parseScopes(claims: ClerkOAuthClaims): string[] {
  const raw = Array.isArray(claims.scopes)
    ? claims.scopes
    : typeof claims.scope === "string"
      ? claims.scope.split(" ").filter((s) => s.length > 0)
      : [];
  const hasRemarksScope = raw.some((s) => s.startsWith("tasks:") || s.startsWith("project:"));
  return hasRemarksScope ? raw : REMARKS_SCOPES;
}

function pickClientName(claims: ClerkOAuthClaims): string {
  return claims.client_name ?? claims.azp ?? claims.client_id ?? "unknown";
}

export async function verifyOAuthToken(jwt: string): Promise<VerifiedToken> {
  // jose validates signature against JWKS, plus exp/nbf/iss when those options
  // are set. We additionally enforce `typ === "at+jwt"` (RFC 9068) so Clerk
  // *session* JWTs (typ "JWT") can't be replayed against MCP tools.
  const { issuer, jwks } = getVerifierConfig();
  const { payload, protectedHeader } = await jwtVerify(jwt, jwks, { issuer });
  if (protectedHeader.typ !== "at+jwt") {
    throw new Error(`Unexpected JWT typ: ${String(protectedHeader.typ)} (expected "at+jwt")`);
  }
  const claims = payload as ClerkOAuthClaims;

  // RFC 8707 audience binding. Clerk's OAuth provider doesn't emit `aud` for
  // dynamically-registered clients today (no "Allowed resources" Dashboard
  // UI; same product gap as custom scopes — see spec-gap A20). When `aud` is
  // present we still validate it; when absent we accept on signature + iss +
  // typ alone. The day Clerk emits `aud`, this branch tightens automatically.
  if (claims.aud !== undefined && !audienceContains(claims.aud, env.MCP_RESOURCE_URI)) {
    throw new Error(
      `Token aud=${JSON.stringify(claims.aud)} does not match resource ${env.MCP_RESOURCE_URI}`
    );
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("Token missing `sub` claim");
  }

  return {
    clerkUserId: claims.sub,
    scopes: parseScopes(claims),
    oauthClientName: pickClientName(claims),
  };
}
