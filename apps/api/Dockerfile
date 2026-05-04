FROM node:20-alpine AS base
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build
# Produce a self-contained flat node_modules with no pnpm symlinks
RUN pnpm deploy --filter api /app/api-deploy

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=base /app/api-deploy/node_modules ./node_modules
COPY --from=base /app/apps/api/dist ./dist
COPY --from=base /app/apps/api/prisma ./prisma
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node","dist/main"]
