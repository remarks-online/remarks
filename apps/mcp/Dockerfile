# syntax=docker/dockerfile:1.7
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/mcp/package.json ./apps/mcp/
COPY packages/shared/package.json ./packages/shared/
COPY packages/mcp-schema/package.json ./packages/mcp-schema/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @remarks/mcp...

FROM base AS build
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/mcp-schema ./packages/mcp-schema
COPY apps/mcp ./apps/mcp
RUN pnpm --filter @remarks/shared run build \
 && pnpm --filter @remarks/mcp-schema run build \
 && pnpm --filter @remarks/mcp run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/mcp-schema/node_modules ./packages/mcp-schema/node_modules
COPY --from=build /app/apps/mcp/package.json ./apps/mcp/
COPY --from=build /app/apps/mcp/dist ./apps/mcp/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/mcp-schema/package.json ./packages/mcp-schema/
COPY --from=build /app/packages/mcp-schema/dist ./packages/mcp-schema/dist
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
EXPOSE 3000
CMD ["node", "apps/mcp/dist/index.js"]
