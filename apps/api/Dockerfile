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

ENV NODE_ENV=production
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["node", "dist/main"]
