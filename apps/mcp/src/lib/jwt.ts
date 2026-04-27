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

function audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (aud === undefined) return false;
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
  // are set. It does not enforce a specific `typ` unless asked, so RFC 9068
  // `at+jwt` tokens are accepted alongside legacy `JWT` typ.
  const { issuer, jwks } = getVerifierConfig();
  const { payload } = await jwtVerify(jwt, jwks, { issuer });
  const claims = payload as ClerkOAuthClaims;

  if (!audienceMatches(claims.aud, env.MCP_RESOURCE_URI)) {
    throw new Error("Token audience does not match this resource server");
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
