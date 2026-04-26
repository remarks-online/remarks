# 0011. MCP as the agent contract

Date: 2026-04-21
Status: Accepted (auth model superseded by [ADR-0015](./0015-mcp-oauth-via-clerk.md) on 2026-04-26)

## Context

A core thesis of Remarks is that annotations are not just for humans — they are instructions for coding agents. An agent should be able to list open annotations on a project, mark one "doing," read its screenshot, comment on its progress, and mark it "done," exactly as a human teammate would. We need a protocol for that which is already adopted by the agents we care about (Claude Code, Cursor, Windsurf) and that doesn't require each agent to ship custom Remarks-specific code. The Model Context Protocol (MCP) is the emerging standard for exactly this.

## Decision

The **public agent contract is an MCP server** (`apps/mcp`) that speaks the Model Context Protocol and exposes Remarks operations as MCP tools. Tool schemas live in `packages/mcp-schema` (scaffolded in Phase 0, populated in Phase 2) and are defined in Zod, shared with the REST API so tool arguments validate against the same types as HTTP bodies. The MCP server is a thin adapter over the same service layer the REST API uses; it calls the API internally or shares services directly, so MCP and REST can never diverge in behavior. The MCP server is hosted on Fly at `mcp.remarks.online`.

## Consequences

Any MCP-compatible client can integrate Remarks by pointing at the server and authenticating — no Remarks-specific SDK required. Agents get a typed, self-describing interface. Internally, we have to keep MCP tool schemas and REST schemas aligned; because both derive from the same Zod definitions in `packages/shared` and `packages/mcp-schema`, drift is prevented at compile time. Building the MCP server is deferred to Phase 2; Phase 0 only scaffolds the packages.

## Alternatives considered

**Custom JSON-RPC or webhook integrations per agent** — would require bespoke code in every agent we want to support. **Just document the REST API and let agents call it** — workable but loses the tool-schema semantics that make MCP tools legible to agents without prompt engineering on our side. **OpenAI function-calling JSON schemas as the canonical format** — narrower ecosystem than MCP; MCP works for OpenAI-compatible agents too via adapter.
