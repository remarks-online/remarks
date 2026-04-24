// Thin wrapper around the Clerk Backend API for the verify suite. Mirrors
// apps/dashboard/e2e/clerk.ts shape — intentionally duplicated rather than
// extracted because the two live in different apps and "shared test utils"
// is more scope than this one-off verification warrants.

export interface ClerkUser {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
}

export interface ClerkOrg {
  id: string;
  name: string;
  slug: string;
}

export interface ClerkOrgMembership {
  id: string;
  role: string;
  public_user_data: { user_id: string };
}

interface ClerkSignInToken {
  token: string;
}

async function clerkGet<T>(secretKey: string, path: string): Promise<T> {
  const res = await fetch(`https://api.clerk.com${path}`, {
    headers: { authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Clerk GET ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

async function clerkPost<T>(secretKey: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.clerk.com${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Clerk POST ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T;
}

async function clerkList<T>(secretKey: string, path: string): Promise<T[]> {
  const body = await clerkGet<T[] | { data: T[] }>(secretKey, path);
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function ensureClerkUser(
  secretKey: string,
  email: string,
  opts: { password: string }
): Promise<ClerkUser> {
  const existing = await clerkList<ClerkUser>(
    secretKey,
    `/v1/users?email_address=${encodeURIComponent(email)}`
  );
  if (existing[0]) return existing[0];
  return clerkPost<ClerkUser>(secretKey, "/v1/users", {
    email_address: [email],
    password: opts.password,
    skip_password_checks: true,
  });
}

export async function ensureClerkOrg(
  secretKey: string,
  name: string,
  creatorUserId: string
): Promise<ClerkOrg> {
  const existing = await clerkList<ClerkOrg>(
    secretKey,
    `/v1/organizations?query=${encodeURIComponent(name)}&limit=10`
  );
  const match = existing.find((o) => o.name === name);
  if (match) return match;
  return clerkPost<ClerkOrg>(secretKey, "/v1/organizations", {
    name,
    created_by: creatorUserId,
  });
}

export async function ensureClerkOrgMembership(
  secretKey: string,
  orgId: string,
  userId: string,
  role: string
): Promise<ClerkOrgMembership> {
  const existing = await clerkList<ClerkOrgMembership>(
    secretKey,
    `/v1/organizations/${orgId}/memberships?limit=100`
  );
  const match = existing.find((m) => m.public_user_data.user_id === userId);
  if (match) return match;
  return clerkPost<ClerkOrgMembership>(secretKey, `/v1/organizations/${orgId}/memberships`, {
    user_id: userId,
    role,
  });
}

export async function mintSignInToken(secretKey: string, userId: string): Promise<string> {
  const { token } = await clerkPost<ClerkSignInToken>(secretKey, "/v1/sign_in_tokens", {
    user_id: userId,
  });
  return token;
}
