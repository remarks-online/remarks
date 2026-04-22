# 0008. Zod at every boundary

Date: 2026-04-21
Status: Accepted

## Context

The Remarks system has many trust boundaries: browser extension → API, dashboard → API, API → database, API → R2, Clerk webhooks → API, environment variables → app boot. Every one of these is a place where malformed data can cause silent corruption or runtime errors far from the source. TypeScript types are erased at runtime and give us zero help validating data coming in from the network, config, or webhooks. We need one validation library that works on both client and server, produces typed values, and returns clear errors we can surface to callers.

## Decision

Use **Zod** for every boundary in the system. Zod schemas for anything crossing a service boundary live in `packages/shared/schemas/`. Every API route validates the request body, query, and params with Zod before calling service code. Every service that reads `process.env` validates it with Zod on boot (CLAUDE.md §1.8). MCP tool schemas live in `packages/mcp-schema` and are Zod-derived. Skipping Zod validation on env or API bodies is forbidden (CLAUDE.md §1.10).

## Consequences

A single mental model for "validate and parse, don't just cast" is applied uniformly. Schemas are shared between the API and clients (extension, dashboard) via `packages/shared`, so request/response types are always in sync with the validator. Zod adds a few ms of overhead per request — negligible versus the value of catching bad data at the edge. Error messages from Zod are consistent and easy to surface to the UI.

## Alternatives considered

**Yup** — weaker TypeScript inference and no first-class discriminated unions. **io-ts** — more theoretically pure but much less ergonomic, especially for large nested schemas. **Valibot** — faster and smaller bundle, promising, but ecosystem around Zod (tRPC, Drizzle-Zod, OpenAPI gen) is deeper at the time of this decision. **Ajv + JSON Schema** — fine for OpenAPI-first shops; we are TypeScript-first.
