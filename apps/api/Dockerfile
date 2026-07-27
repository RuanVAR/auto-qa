FROM node:20-alpine
RUN apk add --no-cache openssl
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        ./apps/api/
COPY apps/indexer/package.json    ./apps/indexer/
COPY apps/web/package.json        ./apps/web/
COPY apps/worker/package.json     ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage/package.json ./packages/storage/
RUN pnpm install --frozen-lockfile
COPY . .
# Build the workspace packages first — the api imports their compiled dist
# (shared: secret-box + spec DSL; storage: artifact drivers).
RUN pnpm --filter @qa-platform/shared build
RUN pnpm --filter @qa-platform/storage build
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

ENV NODE_ENV=production
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["node", "dist/main"]
