import { InternalError } from "@remarks/shared";
import { env } from "../env.js";
import type { AuthContext } from "../types/auth.js";

const RESOLVE_PATH = "/internal/mcp/tokens/resolve";

// Calls the API's internal token-resolution endpoint (task 2.5). Returns the
// resolved auth context on a 200, `null` on a 404 (unknown / expired /
// revoked — the API decides which qualifies). Anything else is a transport or
// upstream bug; the auth plugin lets it bubble out as a 500.
export async function resolveToken(tokenHash: string): Promise<AuthContext | null> {
  let response: Response;
  try {
    response = await fetch(`${env.API_INTERNAL_URL}${RESOLVE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-auth": env.INTERNAL_API_TOKEN,
      },
      body: JSON.stringify({ tokenHash }),
    });
  } catch (cause) {
    throw new InternalError("Failed to reach Remarks API for token resolution", cause);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new InternalError(`Token resolution failed with status ${response.status}`);
  }

  const body = (await response.json()) as AuthContext;
  return body;
}
