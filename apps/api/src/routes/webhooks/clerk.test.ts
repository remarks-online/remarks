import sensible from "@fastify/sensible";
import { RemarksError, ValidationError } from "@remarks/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const SECRET = process.env.CLERK_WEBHOOK_SECRET as string;

const mocks = vi.hoisted(() => ({
  upsertUser: vi.fn(async () => {}),
  softDeleteUser: vi.fn(async () => {}),
  upsertOrg: vi.fn(async () => {}),
  deleteOrg: vi.fn(async () => {}),
}));

vi.mock("../../services/clerk-sync.service.js", () => mocks);

const { clerkWebhookRoutes } = await import("./clerk.js");
const { default: rawBodyPlugin } = await import("../../plugins/raw-body.js");

function buildTestServer(): FastifyInstance {
  const server = Fastify({ logger: false });
  server.setErrorHandler((err, request, reply) => {
    if (err instanceof RemarksError) {
      const body: {
        error: { code: string; message: string; requestId: string; issues?: unknown };
      } = {
        error: {
          code: err.code,
          message: err.exposed ? err.message : "Internal server error",
          requestId: request.id,
        },
      };
      if (err instanceof ValidationError && err.issues !== undefined) {
        body.error.issues = err.issues;
      }
      return reply.status(err.statusCode).send(body);
    }
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: request.id },
    });
  });
  server.decorate("db", {} as never);
  return server;
}

async function registerPlugins(server: FastifyInstance): Promise<void> {
  await server.register(sensible);
  await server.register(rawBodyPlugin);
  await server.register(clerkWebhookRoutes);
}

function signedRequest(payload: object): {
  body: string;
  headers: Record<string, string>;
} {
  const body = JSON.stringify(payload);
  const wh = new Webhook(SECRET);
  const msgId = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, body);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": msgId,
      "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "svix-signature": signature,
    },
  };
}

describe("POST /webhooks/clerk", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockClear();
    server = buildTestServer();
    await registerPlugins(server);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  test("rejects requests missing Svix headers with 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      payload: { type: "user.created", data: {} },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  test("rejects invalid signatures with 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_bad",
        "svix-timestamp": Math.floor(Date.now() / 1000).toString(),
        "svix-signature": "v1,deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
      payload: JSON.stringify({ type: "user.created", data: {} }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  test("user.created dispatches to upsertUser and returns 200 ok", async () => {
    const payload = {
      type: "user.created",
      data: {
        id: "user_123",
        email_addresses: [{ id: "idn_1", email_address: "alice@example.com" }],
        primary_email_address_id: "idn_1",
        first_name: "Alice",
        last_name: "Dev",
        image_url: "https://img.example.com/alice.png",
      },
    };
    const { body, headers } = signedRequest(payload);

    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(mocks.upsertUser).toHaveBeenCalledTimes(1);
    expect(mocks.upsertUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "user_123", first_name: "Alice" })
    );
  });

  test("organization.deleted dispatches to deleteOrg", async () => {
    const { body, headers } = signedRequest({
      type: "organization.deleted",
      data: { id: "org_123" },
    });
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.deleteOrg).toHaveBeenCalledWith(expect.anything(), "org_123");
  });

  test("unhandled event type returns 200 ignored and dispatches nothing", async () => {
    const { body, headers } = signedRequest({
      type: "session.created",
      data: { id: "sess_1" },
    });
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ignored" });
    expect(mocks.upsertUser).not.toHaveBeenCalled();
    expect(mocks.upsertOrg).not.toHaveBeenCalled();
    expect(mocks.softDeleteUser).not.toHaveBeenCalled();
    expect(mocks.deleteOrg).not.toHaveBeenCalled();
  });

  test("replaying user.created is safely idempotent at the dispatch layer", async () => {
    const payload = {
      type: "user.created",
      data: {
        id: "user_dup",
        email_addresses: [{ id: "idn_1", email_address: "dup@example.com" }],
        primary_email_address_id: "idn_1",
        first_name: null,
        last_name: null,
        image_url: null,
      },
    };
    const { body, headers } = signedRequest(payload);

    const first = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      headers,
      payload: body,
    });
    const second = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      headers,
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(mocks.upsertUser).toHaveBeenCalledTimes(2);
  });
});
