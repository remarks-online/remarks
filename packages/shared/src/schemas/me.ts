import { z } from "zod";

export const currentUserSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    clerkUserId: z.string().min(1),
    email: z.string().email().nullable(),
    name: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
  }),
  orgMemberships: z.array(
    z.object({
      clerkOrgId: z.string().min(1),
      role: z.string().min(1),
    })
  ),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
