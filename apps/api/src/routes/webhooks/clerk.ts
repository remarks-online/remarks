import { UnauthorizedError, clerkWebhookEventSchema } from "@remarks/shared";
import type { FastifyPluginAsync } from "fastify";
import { Webhook } from "svix";
import { env } from "../../env.js";
import { capture } from "../../lib/posthog.js";
import {
  deleteOrg,
  removeProjectMembersForOrgMember,
  softDeleteUser,
  syncProjectMembersForOrgMember,
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
        await upsertOrg(fastify.db, event.data);
        // Spec §7.5 — emit once per org. `created_by` is the Clerk user id of
        // the org creator; webhook may omit it for system-created orgs in
        // which case we fall back to the org id as the distinct id.
        capture({
          event: "org_created",
          distinctId: event.data.created_by ?? event.data.id,
          properties: {
            clerkOrgId: event.data.id,
            slug: event.data.slug,
          },
        });
        break;
      case "organization.updated":
        await upsertOrg(fastify.db, event.data);
        break;
      case "organization.deleted":
        await deleteOrg(fastify.db, event.data.id);
        break;
      case "organizationMembership.created":
      case "organizationMembership.updated":
        await syncProjectMembersForOrgMember(
          fastify.db,
          event.data.organization.id,
          event.data.public_user_data.user_id,
          { clerk: fastify.clerk }
        );
        break;
      case "organizationMembership.deleted":
        await removeProjectMembersForOrgMember(
          fastify.db,
          event.data.organization.id,
          event.data.public_user_data.user_id
        );
        break;
    }

    return { status: "ok" as const };
  });
};
