import { relations } from "drizzle-orm";
import { annotationAssets } from "./annotation-assets.js";
import { annotationEvents } from "./annotation-events.js";
import { annotations } from "./annotations.js";
import { branches } from "./branches.js";
import { organizations } from "./organizations.js";
import { projectApiTokens } from "./project-api-tokens.js";
import { projectMembers } from "./project-members.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ many }) => ({
  authoredAnnotations: many(annotations),
  projectMemberships: many(projectMembers),
  annotationEvents: many(annotationEvents),
  createdApiTokens: many(projectApiTokens),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
  branches: many(branches),
  annotations: many(annotations),
  members: many(projectMembers),
  apiTokens: many(projectApiTokens),
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
  actorToken: one(projectApiTokens, {
    fields: [annotationEvents.actorTokenId],
    references: [projectApiTokens.id],
  }),
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

export const projectApiTokensRelations = relations(projectApiTokens, ({ one }) => ({
  project: one(projects, {
    fields: [projectApiTokens.projectId],
    references: [projects.id],
  }),
  createdBy: one(users, {
    fields: [projectApiTokens.createdById],
    references: [users.id],
  }),
}));
