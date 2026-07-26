FROM node:20-alpine
RUN apk add --no-cache openssl
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter indexer... --frozen-lockfile
COPY . .
RUN cp apps/api/prisma/schema.prisma apps/indexer/schema.prisma \
    && pnpm --filter indexer exec prisma generate --schema schema.prisma \
    && rm apps/indexer/schema.prisma

EXPOSE 3004
ENV CHOKIDAR_USEPOLLING=1
CMD ["pnpm", "--filter", "indexer", "dev"]
