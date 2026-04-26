# 0015. MCP authentication via Clerk OAuth 2.1

Date: 2026-04-26
Status: Accepted

## Context

ADR-0011 named MCP as the agent contract but punted on the auth model. The Phase 2 spec (`docs/plan/remarks-phase-2-spec.md` §5.1, written before this ADR) filled that gap with project-scoped bearer tokens (`rmk_live_…`) generated in the dashboard and pasted into each agent's MCP config. That model works and was straightforward to build, but it's the API-key pattern. Hosted MCP servers shipped in 2025 — Atlassian, Linear, Stytch, Asana — moved to OAuth 2.1 with PKCE and dynamic client registration so users can run a single `claude mcp add --transport http <name> <url>` and complete a browser login instead of generating and pasting a secret. The MCP authorization spec (2025-03-26 onward) is built around this path: protected resource metadata (RFC 9728), authorization server metadata (RFC 8414), PKCE S256, RFC 8707 resource indicators, and either dynamic client registration (RFC 7591) or client ID metadata documents.

We already use Clerk (ADR-0003) for end-user auth in the dashboard and the API. Clerk now ships first-class MCP support: a togglable `Dynamic client registration` setting on OAuth applications, public-client PKCE per app, an OAuth Authorization Server Metadata endpoint that advertises `code_challenge_methods_supported: ["S256"]`, and an `@clerk/mcp-tools` package providing `verifyClerkToken`, `generateClerkProtectedResourceMetadata`, and `fetchClerkAuthorizationServerMetadata`.

Continuing with the bearer-token flow ships a UX the ecosystem has already moved past, on a stack where the alternative requires no new vendor and is already a first-class Clerk feature.

## Decision

The MCP server (`apps/mcp`) is an **OAuth 2.1 resource server**. Clerk is the **authorization server**. Tokens are Clerk-issued JWTs validated against Clerk's JWKS.

Specifics:

- **Transport auth:** `Authorization: Bearer <jwt>` on every MCP request. Missing/invalid token → `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="tasks:read tasks:write project:read"`.
- **Discovery:** the MCP server publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource/mcp`, listing the Clerk tenant's issuer URL in `authorization_servers`. Clerk publishes the AS metadata at its standard `/.well-known/oauth-authorization-server` endpoint.
- **Client registration:** RFC 7591 dynamic client registration, enabled on the Clerk OAuth applications page. Pre-registration is the fallback for enterprise customers. The MCP spec's preferred Client ID Metadata Documents path is not enabled in Phase 2 because Clerk doesn't yet support it; tracked as a follow-up if/when Clerk ships it.
- **PKCE:** S256, mandatory (Clerk enforces).
- **Resource indicator (RFC 8707):** clients pass `resource=https://mcp.remarks.dev/mcp`. The MCP server validates that the JWT's audience claim contains this canonical URI.
- **Token scope:** **one access token covers every project the authenticated Clerk user is a member of.** Authorization happens per tool call: handlers that take `project_id` (or `task_id`, which resolves to a project) check `project_members` membership for the Clerk user. `remarks_whoami` returns the list of accessible projects and the user's own profile.
- **OAuth scopes:** `tasks:read` (list/get), `tasks:write` (update/comment/batch), `project:read` (`get_project_context`). `whoami` requires only authentication. Defined per OAuth-app in the Clerk Dashboard.
- **Caching:** project membership cached in Redis at `cache:mcp:projects:{clerkUserId}` with a 300s TTL — same shape and key style as the membership cache the dashboard already uses, just keyed by Clerk user instead of session.
- **Token format:** Clerk-issued, signed by Clerk, validated locally with `verifyClerkToken` using Clerk's JWKS.
- **`project_api_tokens` table is removed.** Phase 2 has not shipped to production; there are no live tokens to grandfather. Per CLAUDE.md the spec forbids backwards-compat shims when the change is ground-up. Headless/CI scenarios that need a long-lived secret get a dedicated Clerk service-account flow in a future ADR; out of scope here.

## Consequences

**Wins.** Single-command install via `claude mcp add --transport http remarks https://mcp.remarks.dev`. No tokens stored on disk in plaintext. Per-grant revocation surfaced in account settings (calls Clerk's grant API). Refresh-token rotation per OAuth 2.1 §4.3.1 — handled by Clerk and clients, no code on our side. Audit attribution moves to Clerk user × OAuth client name (e.g., "Claude Code", "Cursor"), captured at DCR time and visible in the events table.

**Costs and risks.**
- **Token blast radius.** A compromised access token reaches every project the Clerk user can see. Mitigated by short access-token lifetime (Clerk default 2h), refresh-token rotation, per-grant revocation, and rate limiting at `ratelimit:mcp:{bucket}:{clerkUserId}`. If this becomes a real problem, the future migration is per-project consent via RFC 8707 resource indicator with a project-specific `resource` URI — no schema changes needed, just dashboard UX changes.
- **Vendor coupling.** The MCP auth path depends on Clerk's OAuth-provider feature staying available. Mitigated by the standardness of the protocol — replacing Clerk with another AS (Auth0, Logto, custom) means re-pointing PRM at a different `authorization_servers` URL and swapping `verifyClerkToken` for the equivalent JWKS validator. The MCP server itself stays unchanged.
- **`@clerk/mcp-tools` maturity.** v0.5.0 as of 2026-04, MIT, actively maintained but new. Helpers are pure functions over Clerk's HTTP API; if the package goes unmaintained we replace ~50 LOC of helper code with our own JWKS validator and metadata generator.
- **Loss of long-lived CI tokens.** Phase 2 didn't ship them either, so this is a no-op for current users; flagged as a follow-up so it doesn't get forgotten.

**Spec impact.** Phase 2 spec §5 ("Authentication and authorization"), §6 ("Install experience"), and §7.3 (events schema) are rewritten to match this ADR. ADR-0011 stays the contract for "MCP is the agent interface"; this ADR supersedes its silent assumption that auth was bearer-token-shaped.

## Alternatives considered

- **Keep the bearer-token flow.** Already specced, would have shipped sooner. Rejected because the UX (dashboard → mint → paste → restart agent) is the worst-feeling part of integrating an MCP server in 2026, and the alternative is no extra vendor on a stack we already pay for.
- **Custom authorization server in `apps/api`.** We'd implement `/oauth/authorize`, `/oauth/token`, `/oauth/register`, the JWKS, and PKCE ourselves on top of Clerk's user sessions. Total control; more code; more attack surface; slower to ship. Worth revisiting if Clerk's OAuth-provider product gets pulled.
- **Clerk Organizations as the unit of consent.** Map each Remarks project to a Clerk organization; tokens carry an `org_id` claim and are inherently project-scoped. Cleaner semantics, but Remarks projects and Clerk orgs aren't the same concept (orgs have billing, projects don't), and the migration touches every part of the stack. Rejected for now in favor of all-projects tokens with per-call membership checks. Path to per-project scoping is preserved via the RFC 8707 `resource` parameter.
- **Client ID Metadata Documents (SEP-991) instead of DCR.** The MCP spec's preferred path. Cleaner: each agent hosts a JSON document at a stable HTTPS URL; the AS fetches and validates it on each authorization request. Clerk doesn't support this yet (as of 2026-04). When it does, we add `client_id_metadata_document_supported: true` to PRM and the MCP clients pick it up automatically — no change to our code beyond the Clerk dashboard toggle.
