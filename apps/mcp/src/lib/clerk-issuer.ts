import { env } from "../env.js";

// Clerk publishable keys encode the frontend API host as base64 in the segment
// after `pk_test_` / `pk_live_`. This is the same trick used by `@clerk/clerk-js`
// at boot. Deriving from the publishable key keeps issuer + key tied together
// so we can never mis-pair them across environments.
export function clerkIssuerFromPublishableKey(): string {
  const segments = env.CLERK_PUBLISHABLE_KEY.split("_");
  const encoded = segments[segments.length - 1] ?? "";
  try {
    const host = Buffer.from(encoded, "base64").toString("utf-8").replace(/\$$/, "");
    return host.startsWith("http") ? host : `https://${host}`;
  } catch {
    return "https://clerk.com";
  }
}
