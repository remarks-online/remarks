import type { McpErrorCode } from "@remarks/mcp-schema";

// Domain error a tool handler throws when it can fail in a way the spec §3.3
// table calls out. The MCP route handler catches this and returns the SDK's
// `isError: true` envelope; everything else (programmer error, infra) bubbles
// out as a JSON-RPC `-32603` so support can correlate via the request id.
export class McpToolError extends Error {
  readonly code: McpErrorCode;
  readonly details: unknown;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: McpErrorCode,
    message: string,
    options: { details?: unknown; retryAfterSeconds?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "McpToolError";
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface McpToolErrorPayload {
  code: McpErrorCode;
  message: string;
  details?: unknown;
  retry_after_seconds?: number;
  request_id?: string;
}

export function toMcpToolErrorPayload(err: McpToolError, requestId: string): McpToolErrorPayload {
  const payload: McpToolErrorPayload = {
    code: err.code,
    message: err.message,
    request_id: requestId,
  };
  if (err.details !== undefined) payload.details = err.details;
  if (err.retryAfterSeconds !== undefined) payload.retry_after_seconds = err.retryAfterSeconds;
  return payload;
}
