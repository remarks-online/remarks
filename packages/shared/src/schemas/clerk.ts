import { z } from "zod";

const clerkEmail = z.object({
  id: z.string(),
  email_address: z.string().email(),
});

const clerkUserData = z.object({
  id: z.string(),
  email_addresses: z.array(clerkEmail),
  primary_email_address_id: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  image_url: z.string().nullable(),
});

const clerkUserDeletedData = z.object({ id: z.string() });

const clerkOrgData = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

const clerkOrgDeletedData = z.object({ id: z.string() });

export const clerkWebhookEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user.created"), data: clerkUserData }),
  z.object({ type: z.literal("user.updated"), data: clerkUserData }),
  z.object({ type: z.literal("user.deleted"), data: clerkUserDeletedData }),
  z.object({ type: z.literal("organization.created"), data: clerkOrgData }),
  z.object({ type: z.literal("organization.updated"), data: clerkOrgData }),
  z.object({ type: z.literal("organization.deleted"), data: clerkOrgDeletedData }),
]);

export type ClerkWebhookEvent = z.infer<typeof clerkWebhookEventSchema>;
export type ClerkUserData = z.infer<typeof clerkUserData>;
export type ClerkOrgData = z.infer<typeof clerkOrgData>;
