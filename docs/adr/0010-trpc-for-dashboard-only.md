# 0010. tRPC for the dashboard only

Date: 2026-04-21
Status: Accepted

## Context

The API serves three very different clients: the Next.js dashboard (which can share TypeScript types with the server and benefits from end-to-end type safety), the browser extension (which ships compiled JavaScript to end-user browsers and should not leak server types into the bundle), and the MCP server + future third-party integrators (which need a stable, language-agnostic contract). A single RPC abstraction for all three would force a tradeoff we don't want to make.

## Decision

The API exposes **two shapes**: a **REST + Zod contract** (documented via OpenAPI) used by the extension, the MCP server, and any external caller; and a **tRPC router** used *only* by the dashboard. The tRPC router lives alongside the REST routes in `apps/api/src/trpc/` and wraps the same underlying service layer (`apps/api/src/services/*`) — so the two surfaces never drift in behavior. The dashboard imports tRPC types directly from the API package, giving it full end-to-end safety. The extension and MCP clients call REST endpoints and validate responses with Zod schemas from `packages/shared`.

## Consequences

Dashboard developers get the fastest possible inner loop — change a router, the dashboard's types update. External consumers (including the extension, which we ship to end-users) get a stable, versionable, documented REST API that doesn't require the tRPC runtime. The cost is two code paths on the server; we mitigate by keeping both paths thin and delegating to the shared service layer.

## Alternatives considered

**tRPC everywhere** — rejected because shipping the tRPC client into the extension bundle is wasteful and makes third-party integration awkward. **REST everywhere** — rejected because we'd lose the tRPC productivity win in the dashboard, which is the surface that iterates most. **GraphQL** — too heavy for the query shape we have; REST + tRPC gives us the real benefit of typed clients without the operational cost of a GraphQL server.
