import { createClerkClient } from "@clerk/backend";
import { env } from "../env.js";

// Clerk-backed JWT verifier for OAuth access tokens issued by Clerk's OAuth
// provider (ADR-0015). Verifies signature against Clerk's JWKS, plus standard
// claims (iss, aud, exp, nbf). Throws on any failure; the caller maps to 401.
//
// `aud` is checked against MCP_RESOURCE_URI per RFC 8707 — refuses tokens that
// were issued for a different resource server.

const clerk = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
});

export interface VerifiedToken {
  clerkUserId: string;
  scopes: string[];
  oauthClientName: string;
}

interface ClerkOAuthClaims {
  sub: string;
  aud?: string | string[];
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

function parseScopes(claims: ClerkOAuthClaims): string[] {
  if (Array.isArray(claims.scopes)) return claims.scopes;
  if (typeof claims.scope === "string") {
    return claims.scope.split(" ").filter((s) => s.length > 0);
  }
  return [];
}

function pickClientName(claims: ClerkOAuthClaims): string {
  return claims.client_name ?? claims.azp ?? claims.client_id ?? "unknown";
}

export async function verifyOAuthToken(jwt: string): Promise<VerifiedToken> {
  // `verifyToken` validates signature + standard claims against Clerk's JWKS.
  // Throws on signature/expiry/nbf failure.
  const claims = (await clerk.authenticateRequest.constructor) as never;
  // Use Clerk's exported verifier for raw JWTs:
  const { verifyToken } = await import("@clerk/backend");
  const result = (await verifyToken(jwt, {
    secretKey: env.CLERK_SECRET_KEY,
  })) as unknown as ClerkOAuthClaims;

  if (!audienceMatches(result.aud, env.MCP_RESOURCE_URI)) {
    throw new Error("Token audience does not match this resource server");
  }
  if (typeof result.sub !== "string" || result.sub.length === 0) {
    throw new Error("Token missing `sub` claim");
  }

  void claims;
  return {
    clerkUserId: result.sub,
    scopes: parseScopes(result),
    oauthClientName: pickClientName(result),
  };
}
