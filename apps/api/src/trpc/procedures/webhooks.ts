import { randomBytes } from "node:crypto";
import { type DB, schema } from "@remarks/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RemarksError,
  type WebhookCreatedResponse,
  type WebhookDeliveryResponse,
  type WebhookResponse,
  createWebhookRequestSchema,
  updateWebhookRequestSchema,
  webhookCreatedResponseSchema,
  webhookDeliveryResponseSchema,
  webhookEventTypeSchema,
  webhookResponseSchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { z } from "zod";
import { assertProjectMember } from "../../lib/project-authorization.js";
import { protectedProcedure, router } from "../trpc.js";

function mapError(err: unknown): never {
  if (err instanceof NotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
  }
  if (err instanceof ForbiddenError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
  }
  if (err instanceof ConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: err.message, cause: err });
  }
  if (err instanceof RemarksError) throw err;
  throw err;
}

const projectIdInput = z.object({ projectId: z.string().uuid() });
const webhookIdInput = z.object({ webhookId: z.string().uuid() });

const createInput = z.object({
  projectId: z.string().uuid(),
  input: createWebhookRequestSchema,
});

const updateInput = z.object({
  webhookId: z.string().uuid(),
  input: updateWebhookRequestSchema,
});

const listDeliveriesInput = z.object({
  webhookId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

interface DeliveryCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: DeliveryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): DeliveryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as DeliveryCursor;
    if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

// 32 random bytes → 64-char hex. Receivers HMAC-verify against this; we never
// expose it again after the create / rotate response.
function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

async function loadWebhookOrThrow(
  db: DB,
  webhookId: string
): Promise<{ id: string; projectId: string }> {
  const row = await db.query.projectWebhooks.findFirst({
    where: eq(schema.projectWebhooks.id, webhookId),
    columns: { id: true, projectId: true },
  });
  if (!row) throw new NotFoundError("Webhook");
  return row;
}

function toWebhookResponse(row: typeof schema.projectWebhooks.$inferSelect): WebhookResponse {
  return webhookResponseSchema.parse({
    id: row.id,
    projectId: row.projectId,
    url: row.url,
    events: row.events,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export const webhooksRouter = router({
  list: protectedProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
    try {
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId, { minRole: "admin" });
      const rows = await ctx.db.query.projectWebhooks.findMany({
        where: eq(schema.projectWebhooks.projectId, input.projectId),
        orderBy: [desc(schema.projectWebhooks.createdAt)],
      });
      return rows.map(toWebhookResponse);
    } catch (err) {
      mapError(err);
    }
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    try {
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId, { minRole: "admin" });
      const secret = generateSecret();
      const [row] = await ctx.db
        .insert(schema.projectWebhooks)
        .values({
          projectId: input.projectId,
          url: input.input.url,
          secret,
          events: input.input.events,
        })
        .returning();
      if (!row) throw new Error("project_webhooks insert returned no rows");
      const response: WebhookCreatedResponse = {
        ...toWebhookResponse(row),
        secret,
      };
      return webhookCreatedResponseSchema.parse(response);
    } catch (err) {
      mapError(err);
    }
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    try {
      const webhook = await loadWebhookOrThrow(ctx.db, input.webhookId);
      await assertProjectMember(ctx.db, ctx.user.id, webhook.projectId, { minRole: "admin" });
      const updates: Partial<typeof schema.projectWebhooks.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.input.url !== undefined) updates.url = input.input.url;
      if (input.input.events !== undefined) updates.events = input.input.events;
      if (input.input.active !== undefined) updates.active = input.input.active;
      const [row] = await ctx.db
        .update(schema.projectWebhooks)
        .set(updates)
        .where(eq(schema.projectWebhooks.id, input.webhookId))
        .returning();
      if (!row) throw new NotFoundError("Webhook");
      return toWebhookResponse(row);
    } catch (err) {
      mapError(err);
    }
  }),

  rotateSecret: protectedProcedure.input(webhookIdInput).mutation(async ({ ctx, input }) => {
    try {
      const webhook = await loadWebhookOrThrow(ctx.db, input.webhookId);
      await assertProjectMember(ctx.db, ctx.user.id, webhook.projectId, { minRole: "admin" });
      const secret = generateSecret();
      const [row] = await ctx.db
        .update(schema.projectWebhooks)
        .set({ secret, updatedAt: new Date() })
        .where(eq(schema.projectWebhooks.id, input.webhookId))
        .returning();
      if (!row) throw new NotFoundError("Webhook");
      const response: WebhookCreatedResponse = {
        ...toWebhookResponse(row),
        secret,
      };
      return webhookCreatedResponseSchema.parse(response);
    } catch (err) {
      mapError(err);
    }
  }),

  delete: protectedProcedure.input(webhookIdInput).mutation(async ({ ctx, input }) => {
    try {
      const webhook = await loadWebhookOrThrow(ctx.db, input.webhookId);
      await assertProjectMember(ctx.db, ctx.user.id, webhook.projectId, { minRole: "admin" });
      await ctx.db
        .delete(schema.projectWebhooks)
        .where(eq(schema.projectWebhooks.id, input.webhookId));
      return { id: input.webhookId } as const;
    } catch (err) {
      mapError(err);
    }
  }),

  listDeliveries: protectedProcedure.input(listDeliveriesInput).query(async ({ ctx, input }) => {
    try {
      const webhook = await loadWebhookOrThrow(ctx.db, input.webhookId);
      await assertProjectMember(ctx.db, ctx.user.id, webhook.projectId, { minRole: "admin" });

      const cursor = input.cursor ? decodeCursor(input.cursor) : null;
      const cursorPredicate = cursor
        ? or(
            lt(schema.projectWebhookDeliveries.createdAt, new Date(cursor.createdAt)),
            and(
              eq(schema.projectWebhookDeliveries.createdAt, new Date(cursor.createdAt)),
              lt(schema.projectWebhookDeliveries.id, cursor.id)
            )
          )
        : undefined;

      const rows = await ctx.db.query.projectWebhookDeliveries.findMany({
        where: and(eq(schema.projectWebhookDeliveries.webhookId, input.webhookId), cursorPredicate),
        orderBy: [
          desc(schema.projectWebhookDeliveries.createdAt),
          desc(schema.projectWebhookDeliveries.id),
        ],
        limit: input.limit + 1,
      });

      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      const items: WebhookDeliveryResponse[] = pageRows.map((row) =>
        webhookDeliveryResponseSchema.parse({
          id: row.id,
          webhookId: row.webhookId,
          eventType: row.eventType,
          attempt: row.attempt,
          succeeded: row.succeeded,
          responseStatus: row.responseStatus,
          errorMessage: row.errorMessage,
          createdAt: row.createdAt.toISOString(),
          deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        })
      );
      const last = hasMore ? pageRows[pageRows.length - 1] : undefined;
      const nextCursor = last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null;
      return { items, nextCursor };
    } catch (err) {
      mapError(err);
    }
  }),

  // Sends a synthetic `annotation.created`-shaped Inngest event so the
  // customer can verify their endpoint without waiting for real activity.
  // The Inngest worker validates the webhook is still subscribed, signs the
  // body, and writes a delivery row — same path as a real event.
  test: protectedProcedure
    .input(
      z.object({
        webhookId: z.string().uuid(),
        eventType: webhookEventTypeSchema.default("annotation.created"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const webhook = await loadWebhookOrThrow(ctx.db, input.webhookId);
        await assertProjectMember(ctx.db, ctx.user.id, webhook.projectId, { minRole: "admin" });

        // The deliveries table requires an annotation FK so cascades work.
        // For test fires we look up the most recent annotation on the project;
        // if there is none yet, fail with a friendly message rather than
        // inserting a dummy row.
        const sample = await ctx.db.query.annotations.findFirst({
          where: eq(schema.annotations.projectId, webhook.projectId),
          columns: { id: true },
          orderBy: [desc(schema.annotations.createdAt)],
        });
        if (!sample) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Create at least one annotation on this project before testing webhooks",
          });
        }

        await ctx.inngest.send({
          name: "remarks/webhook.deliver",
          data: {
            webhookId: webhook.id,
            projectId: webhook.projectId,
            annotationId: sample.id,
            eventType: input.eventType,
            payload: { test: true },
            occurredAt: new Date().toISOString(),
          },
        });
        return { ok: true } as const;
      } catch (err) {
        mapError(err);
      }
    }),
});
