import { UnauthorizedError, clerkWebhookEventSchema } from "@remarks/shared";
import type { FastifyPluginAsync } from "fastify";
import { Webhook } from "svix";
import { env } from "../../env.js";
import {
  deleteOrg,
  softDeleteUser,
  upsertOrg,
  upsertUser,
} from "../../services/clerk-sync.service.js";

const REQUIRED_HEADERS = ["svix-id", "svix-timestamp", "svix-signature"] as const;

export const clerkWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);

  fastify.post("/webhooks/clerk", async (req) => {
    const headers: Record<string, string> = {};
    for (const name of REQUIRED_HEADERS) {
      const value = req.headers[name];
      if (typeof value !== "string") {
        throw new UnauthorizedError("Missing Svix headers");
      }
      headers[name] = value;
    }

    let verified: unknown;
    try {
      verified = wh.verify(req.rawBody.toString("utf8"), headers);
    } catch (err) {
      req.log.warn({ err }, "clerk webhook signature verification failed");
      throw new UnauthorizedError("Invalid webhook signature");
    }

    const parsed = clerkWebhookEventSchema.safeParse(verified);
    if (!parsed.success) {
      // Clerk may add event types we don't handle; log and ack so Clerk
      // doesn't retry. Handlers we do care about will have been rejected by
      // Zod only if payload shape changed — surface that in logs.
      req.log.info(
        { verified, issues: parsed.error.issues },
        "clerk webhook: unhandled or unrecognized event"
      );
      return { status: "ignored" as const };
    }

    const event = parsed.data;
    switch (event.type) {
      case "user.created":
      case "user.updated":
        await upsertUser(fastify.db, event.data);
        break;
      case "user.deleted":
        await softDeleteUser(fastify.db, event.data.id);
        break;
      case "organization.created":
      case "organization.updated":
        await upsertOrg(fastify.db, event.data);
        break;
      case "organization.deleted":
        await deleteOrg(fastify.db, event.data.id);
        break;
    }

    return { status: "ok" as const };
  });
};
