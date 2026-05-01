import { schema } from "@remarks/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedOrg,
  seedUser,
  truncateAll,
} from "../../../test/integration/db.js";
import { ensureBucket, readR2EnvOrThrow } from "../../../test/integration/r2.js";
import { type R2Client, createR2Client } from "../../lib/r2.js";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: mocks.getOrganizationMembershipList },
  }),
}));

const { buildServer } = await import("../../server.js");

const BEARER = "Bearer test.token.value";

function mockAuthEvery(args: {
  clerkUserId: string;
  memberships: Array<{ clerkOrgId: string; role: "org:admin" | "org:member" }>;
}): void {
  // SSE + the create call need a fresh mock each request; mockResolvedValue
  // (not Once) lets multiple injects in a test reuse the same identity.
  mocks.verifyToken.mockResolvedValue({ sub: args.clerkUserId });
  mocks.getOrganizationMembershipList.mockResolvedValue({
    data: args.memberships.map((m) => ({
      role: m.role,
      organization: { id: m.clerkOrgId, name: m.clerkOrgId, slug: m.clerkOrgId },
    })),
  });
}

interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

// Read SSE frames from the response body until either `predicate` matches or
// the deadline expires. Returns the matching frame or throws.
async function readUntilFrame(
  body: ReadableStream<Uint8Array>,
  predicate: (frame: SseFrame) => boolean,
  deadlineMs: number
): Promise<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: Uint8Array | undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), remaining)
        ),
      ]);
      if (done) break;
      if (value) buf += decoder.decode(value, { stream: true });

      while (true) {
        const sep = buf.indexOf("\n\n");
        if (sep < 0) break;
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const frame = parseFrame(block);
        if (frame && predicate(frame)) return frame;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }
  throw new Error("SSE deadline exceeded without matching frame");
}

function parseFrame(block: string): SseFrame | null {
  const dataLines: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith(":") || line.length === 0) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).trimStart();
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }
  if (dataLines.length === 0 && event === undefined && id === undefined) return null;
  return { id, event, data: dataLines.join("\n") };
}

async function seedProjectWithMember(): Promise<{
  orgClerkId: string;
  userClerkId: string;
  userId: string;
  projectId: string;
}> {
  const db = await getIntegrationDb();
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      creatorUserId: user.id,
      name: "Test Project",
      slug: `proj-${Math.random().toString(36).slice(2, 10)}`,
      gitRepoUrl: null,
      primaryBranch: "main",
    })
    .returning();
  if (!project) throw new Error("project insert returned no rows");
  await db.insert(schema.projectMembers).values({
    projectId: project.id,
    userId: user.id,
    role: "editor",
  });
  return {
    orgClerkId: org.clerkOrgId,
    userClerkId: user.clerkUserId,
    userId: user.id,
    projectId: project.id,
  };
}

describe("GET /projects/:projectId/events (integration)", () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let r2: R2Client;

  beforeAll(async () => {
    r2 = createR2Client(readR2EnvOrThrow());
    await ensureBucket(r2);
    await getIntegrationDb();
    server = await buildServer();
    // Bind on a random port — Fastify .inject() can't stream SSE.
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("server.listen returned unexpected address shape");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.close();
    await closeIntegrationDb();
    r2.s3.destroy();
  });

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    await truncateAll();
  });

  test("project member receives a `created` event after POST /annotations", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember();
    mockAuthEvery({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const sseRes = await fetch(`${baseUrl}/projects/${projectId}/events`, {
      headers: { authorization: BEARER, accept: "text/event-stream" },
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type") ?? "").toContain("text/event-stream");
    if (!sseRes.body) throw new Error("SSE response body was null");

    // Race: open the stream and start the producer in parallel. The
    // subscription completes synchronously inside the handler before the SSE
    // writer flushes — but the broker subscribes during `streamAnnotationEvents`,
    // so by the time we have HTTP headers the broker has us in its map.
    const created = fetch(`${baseUrl}/projects/${projectId}/annotations`, {
      method: "POST",
      headers: {
        authorization: BEARER,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        branch: "main",
        targetType: "element",
        url: "https://example.com/page",
        targetSelector: "button.cta",
        viewport: { width: 1280, height: 720, dpr: 1 },
        commentText: "live SSE happy path",
      }),
    });
    const createdRes = await created;
    expect(createdRes.status).toBe(201);
    const annotation = (await createdRes.json()) as { id: string };

    const frame = await readUntilFrame(
      sseRes.body,
      (f) => {
        if (f.event !== "created") return false;
        try {
          const parsed = JSON.parse(f.data) as { annotationId?: string };
          return parsed.annotationId === annotation.id;
        } catch {
          return false;
        }
      },
      5_000
    );
    expect(frame.id).toMatch(/^.+:[0-9a-f-]{36}$/);
  });

  test("non-member returns 404", async () => {
    const { projectId } = await seedProjectWithMember();
    const otherUser = await seedUser(await getIntegrationDb(), {
      clerkUserId: "user_outsider",
    });
    mockAuthEvery({
      clerkUserId: otherUser.clerkUserId,
      memberships: [],
    });

    const res = await fetch(`${baseUrl}/projects/${projectId}/events`, {
      headers: { authorization: BEARER, accept: "text/event-stream" },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("Last-Event-ID header replays a buffered event", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember();
    mockAuthEvery({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    // 1) Create one annotation so an event is buffered.
    const createdRes = await fetch(`${baseUrl}/projects/${projectId}/annotations`, {
      method: "POST",
      headers: { authorization: BEARER, "content-type": "application/json" },
      body: JSON.stringify({
        branch: "main",
        targetType: "element",
        url: "https://example.com/seed",
        targetSelector: "div",
        viewport: { width: 800, height: 600, dpr: 1 },
        commentText: "seed",
      }),
    });
    expect(createdRes.status).toBe(201);
    const seed = (await createdRes.json()) as { id: string };

    // Wait briefly for the NOTIFY round-trip to land in the broker buffer
    // before opening the resume connection. 200 ms is generous for local
    // Postgres on the integration network.
    await new Promise((r) => setTimeout(r, 200));

    // 2) Open SSE with Last-Event-ID set to a value that pre-dates the event.
    // The broker buffer doesn't contain that resume id, so it falls through to
    // the DB replay path and re-emits the `created` event.
    const ancientId = "1900-01-01T00:00:00.000Z:00000000-0000-4000-8000-000000000000";
    const res = await fetch(`${baseUrl}/projects/${projectId}/events`, {
      headers: {
        authorization: BEARER,
        accept: "text/event-stream",
        "last-event-id": ancientId,
      },
    });
    expect(res.status).toBe(200);
    if (!res.body) throw new Error("SSE response body was null");

    const frame = await readUntilFrame(
      res.body,
      (f) => {
        if (f.event !== "created") return false;
        try {
          const parsed = JSON.parse(f.data) as { annotationId?: string };
          return parsed.annotationId === seed.id;
        } catch {
          return false;
        }
      },
      5_000
    );
    expect(frame.id).toBeDefined();
  });
});
