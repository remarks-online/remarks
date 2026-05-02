import { relations } from "drizzle-orm";
import { annotationAssets } from "./annotation-assets.js";
import { annotationEvents } from "./annotation-events.js";
import { annotations } from "./annotations.js";
import { branches } from "./branches.js";
import { organizations } from "./organizations.js";
import { projectMembers } from "./project-members.js";
import { projectWebhookDeliveries, projectWebhooks } from "./project-webhooks.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ many }) => ({
  authoredAnnotations: many(annotations),
  projectMemberships: many(projectMembers),
  annotationEvents: many(annotationEvents),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
  creator: one(users, { fields: [projects.creatorUserId], references: [users.id] }),
  branches: many(branches),
  annotations: many(annotations),
  members: many(projectMembers),
  webhooks: many(projectWebhooks),
}));

export const projectWebhooksRelations = relations(projectWebhooks, ({ one, many }) => ({
  project: one(projects, { fields: [projectWebhooks.projectId], references: [projects.id] }),
  deliveries: many(projectWebhookDeliveries),
}));

export const projectWebhookDeliveriesRelations = relations(projectWebhookDeliveries, ({ one }) => ({
  webhook: one(projectWebhooks, {
    fields: [projectWebhookDeliveries.webhookId],
    references: [projectWebhooks.id],
  }),
  annotation: one(annotations, {
    fields: [projectWebhookDeliveries.annotationId],
    references: [annotations.id],
  }),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  project: one(projects, { fields: [branches.projectId], references: [projects.id] }),
  annotations: many(annotations),
}));

export const annotationsRelations = relations(annotations, ({ one, many }) => ({
  project: one(projects, { fields: [annotations.projectId], references: [projects.id] }),
  branch: one(branches, { fields: [annotations.branchId], references: [branches.id] }),
  author: one(users, { fields: [annotations.authorId], references: [users.id] }),
  events: many(annotationEvents),
  assets: many(annotationAssets),
}));

export const annotationEventsRelations = relations(annotationEvents, ({ one }) => ({
  annotation: one(annotations, {
    fields: [annotationEvents.annotationId],
    references: [annotations.id],
  }),
  actor: one(users, { fields: [annotationEvents.actorId], references: [users.id] }),
}));

export const annotationAssetsRelations = relations(annotationAssets, ({ one }) => ({
  annotation: one(annotations, {
    fields: [annotationAssets.annotationId],
    references: [annotations.id],
  }),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));
