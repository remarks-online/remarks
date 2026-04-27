# Clerk MCP setup

How to configure the Remarks Clerk tenant so that `apps/mcp` can act as an OAuth 2.1 resource server with Clerk as the authorization server. Implements [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md).

This is a one-time operator task per environment (dev, staging, production). Re-run only when scopes change or the canonical resource URI moves.

## Prerequisites

- Admin access to the Clerk tenant for the environment.
- The MCP server's canonical URL (production: `https://mcp.remarks.online/mcp`; local dev: `http://localhost:3000/mcp`). No staging environment as of Phase 2.
- The `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` from Clerk Dashboard → API Keys, set in the MCP app's env (`apps/mcp/.env.local` for dev; Fly secrets for staging/prod).

## Steps

### 1. Enable the OAuth provider

1. Clerk Dashboard → **Configure** → **OAuth applications**.
2. If the provider isn't enabled for this tenant, click **Enable OAuth provider**. Confirm the legal/security prompts.

### 2. Toggle Dynamic Client Registration on

1. Same page (**OAuth applications**) → top-of-page settings panel.
2. Toggle **Dynamic client registration** to ON.
3. Confirm the warning. Clerk auto-enforces the consent screen when DCR is on; do not disable consent.

This makes `POST {clerk_issuer}/oauth/register` (RFC 7591) public so MCP clients can self-register at runtime. Without this, every agent would need a pre-registered OAuth app in Clerk — defeating the one-line install promise.

### 3. Define the MCP scopes

> **Currently blocked on Clerk product capability.** Custom OAuth scopes are roadmap-only as of April 2026 (see `clerk.com/docs/guides/configure/auth-strategies/oauth/scoped-access`). Until Clerk ships them, the MCP server bridges this in code: PRM and the 401 challenge advertise `openid` only, and `apps/mcp/src/lib/jwt.ts` `parseScopes()` stubs the three Remarks scopes onto every verified Clerk JWT so per-tool `requireScope()` checks keep passing. Tracked in `docs/plan/spec-gaps.md` A20 — that's the unwind.
>
> When Clerk ships custom scopes, add them here:

OAuth applications page → **Scopes** → **Add scope** for each:

| Scope | Description shown on consent page |
|---|---|
| `tasks:read` | Read tasks and their context across the user's Remarks projects. |
| `tasks:write` | Update task status, comments, and batch updates. |
| `project:read` | Read project metadata and branch task counts. |

These scopes are advertised in the MCP server's PRM document (`scopes_supported`) and in the 401 challenge `WWW-Authenticate` header. Agents request all three by default following the MCP spec's "Scope Selection Strategy."

### 4. Configure the resource (audience)

> **Currently blocked on Clerk product capability.** Clerk's OAuth provider does not honor RFC 8707 `resource` parameters and does not emit an `aud` claim on issued tokens (April 2026 — confirmed against prod). There is no Dashboard UI to register an MCP resource. The MCP server bridges this in `apps/mcp/src/lib/jwt.ts`: it enforces `typ === "at+jwt"` (so Clerk session JWTs can't be replayed) and, when `aud` *is* present, validates it against `MCP_RESOURCE_URI`; missing `aud` is accepted on signature + issuer + typ alone. Spec-gap A20 tracks unwinding once Clerk ships audience binding.
>
> When Clerk ships it, register here:

- Production: `https://mcp.remarks.online/mcp`
- Dev: `http://localhost:3000/mcp`

This is the value Clerk will accept in the `resource` parameter (RFC 8707) and embed in the `aud` claim of issued tokens. The MCP server already validates `aud` when present.

### 5. Configure PKCE and public clients

In each OAuth-app template — including the default applied to dynamically registered clients:

- **Public client:** ON (PKCE-only, no client secret expected from the agent).
- **Code challenge methods:** `S256` (Clerk advertises this in AS metadata; required by the MCP spec).
- **Allowed grant types:** `authorization_code`, `refresh_token`.
- **Application type:** `native` (Claude Code, Cursor, etc. are native apps that listen on `localhost`).
- **Redirect URI policy:** allow `http://127.0.0.1:*/callback` and `http://localhost:*/callback`. MCP-compatible clients use `localhost` callbacks during the OAuth flow.

### 6. Configure token lifetimes (optional)

Clerk defaults are fine for Phase 2:
- Authorization code: 10 minutes
- Access token: 2 hours
- Refresh token: 3 days, rotating

If you adjust them, update §5 of `docs/plan/remarks-phase-2-spec.md` and the `verifyClerkToken` cache TTL in `apps/mcp` to match.

### 7. Verify

From a workstation that can reach the environment's Clerk issuer:

```sh
curl -s "https://<your-clerk-issuer>/.well-known/oauth-authorization-server" | jq '.code_challenge_methods_supported, .registration_endpoint, .scopes_supported'
```

You should see:
- `["S256"]`
- A non-null `registration_endpoint` URL
- An array containing `tasks:read`, `tasks:write`, `project:read`

Then verify the MCP server's PRM:

```sh
curl -s "<MCP_SERVER>/.well-known/oauth-protected-resource/mcp" | jq '.authorization_servers, .scopes_supported, .resource'
```

`.authorization_servers[0]` must equal Clerk's issuer URL for the environment.

### 8. Smoke-test end-to-end (dev only)

```sh
claude mcp add --transport http remarks http://localhost:3000/mcp
# In a new terminal/Claude Code session:
# Run any Remarks tool. A browser window should open at the Clerk login page.
# Log in, approve the three scopes, return to Claude Code, and `remarks_whoami`
# should return your user and your accessible projects.
```

## When this needs to change

- **Scope rename / new scope:** update §3 here, the OAuth-app template in Clerk, the `scopes_supported` field in `apps/mcp/src/routes/well-known.ts`, and the `WWW-Authenticate` header in `apps/mcp/src/plugins/mcp-auth.ts`. Agents will surface a `WWW-Authenticate: Bearer error="insufficient_scope"` 403 on the first call after a scope addition; users have to re-approve.
- **Domain change:** update the canonical resource URI in §4 and the `resource` field in PRM. Existing tokens become invalid (audience mismatch); users complete a new auth flow on next use.
- **Clerk ships Client ID Metadata Documents (SEP-991):** flip `client_id_metadata_document_supported: true` in Clerk's OAuth-app settings; no MCP server code change needed.

## Rollback

If the OAuth path is broken in production, the safest mitigation is to re-enable a maintenance bearer token path *temporarily* — but that requires reinstating the deleted `project_api_tokens` table. Don't do this without an incident write-up. Better: revert the deploy. The Clerk DCR toggle is independent of the MCP server deploy, so toggling DCR back off only stops *new* registrations; existing valid tokens keep working until they expire.
