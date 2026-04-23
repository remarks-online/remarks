// Thin wrapper around the Clerk Backend API for E2E setup. Keep the surface
// small and stateless — anything that seeds DB rows lives in global-setup.ts
// or per-test fixtures, not here.

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

// Clerk list endpoints return either a bare array (users) or the paginated
// `{ data: [...] }` envelope (organizations). Normalize so callers don't care.
async function clerkList<T>(secretKey: string, path: string): Promise<T[]> {
  const body = await clerkGet<T[] | { data: T[] }>(secretKey, path);
  return Array.isArray(body) ? body : (body.data ?? []);
}

export async function ensureClerkUser(
  secretKey: string,
  email: string,
  opts: { password: string; firstName?: string; lastName?: string }
): Promise<ClerkUser> {
  const existing = await clerkList<ClerkUser>(
    secretKey,
    `/v1/users?email_address=${encodeURIComponent(email)}`
  );
  if (existing[0]) return existing[0];
  return clerkPost<ClerkUser>(secretKey, "/v1/users", {
    email_address: [email],
    password: opts.password,
    first_name: opts.firstName,
    last_name: opts.lastName,
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

// Idempotent: returns the existing membership if the user is already in the
// org, otherwise POSTs to create it. `role` is the Clerk role string (e.g.
// "org:admin", "org:member"), not the bare "admin"/"member" form.
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

// Mint a single-use ticket that Clerk redeems at /sign-in?__clerk_ticket=...
// to mint a session without prompting for credentials. Short-lived — callers
// (fixtures) should mint one per test rather than reusing.
export async function mintSignInToken(secretKey: string, userId: string): Promise<string> {
  const { token } = await clerkPost<ClerkSignInToken>(secretKey, "/v1/sign_in_tokens", {
    user_id: userId,
  });
  return token;
}
