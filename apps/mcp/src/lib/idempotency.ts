import { createHash } from "node:crypto";
import type { RemarksToolName } from "@remarks/mcp-schema";
import type { Redis } from "@upstash/redis";

// Phase 2 spec §3.1: "the server caches (key → response) for 24 hours in
// Redis. Duplicate calls return the cached response without re-executing."
export const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

export interface IdempotencyCheckArgs {
  tool: RemarksToolName;
  tokenId: string;
  key: string;
  payload: unknown;
}

export interface IdempotencyStoreArgs extends IdempotencyCheckArgs {
  response: unknown;
}

export type IdempotencyResult<T> =
  | { kind: "miss" }
  | { kind: "hit"; response: T }
  | { kind: "conflict" };

// Constructor-injected like ApiClient (see apps/mcp/src/tools/types.ts) so
// tests can pass an in-memory fake. Each handler that mutates calls `check`
// before doing work; on `miss`, it does the work and calls `store`.
export interface IdempotencyCache {
  check<T>(args: IdempotencyCheckArgs): Promise<IdempotencyResult<T>>;
  store(args: IdempotencyStoreArgs): Promise<void>;
}

interface CachedEntry {
  payloadHash: string;
  response: unknown;
}

// Recursively sort object keys so two semantically-equal payloads with
// different key insertion orders hash identically. Arrays preserve order
// (positional meaning) but their elements are normalized too.
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = canonicalize(obj[k]);
  }
  return out;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

// Token-scoped key — defense in depth. The schema requires UUID v4 (§3.1)
// but a UUID alone doesn't bind a key to a token; scoping the cache namespace
// by tokenId means one token's idempotency keys can't collide with another's.
function buildKey(tool: RemarksToolName, tokenId: string, key: string): string {
  return `idempotency:${tool}:${tokenId}:${key}`;
}

export function createRedisIdempotencyCache(client: Redis): IdempotencyCache {
  return {
    async check<T>(args: IdempotencyCheckArgs): Promise<IdempotencyResult<T>> {
      const cacheKey = buildKey(args.tool, args.tokenId, args.key);
      const cached = await client.get<CachedEntry>(cacheKey);
      if (!cached) return { kind: "miss" };
      const incomingHash = hashPayload(args.payload);
      if (cached.payloadHash !== incomingHash) return { kind: "conflict" };
      return { kind: "hit", response: cached.response as T };
    },
    async store(args: IdempotencyStoreArgs): Promise<void> {
      const cacheKey = buildKey(args.tool, args.tokenId, args.key);
      const entry: CachedEntry = {
        payloadHash: hashPayload(args.payload),
        response: args.response,
      };
      await client.set(cacheKey, entry, { ex: IDEMPOTENCY_TTL_SECONDS });
    },
  };
}
