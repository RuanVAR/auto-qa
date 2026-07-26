# Dev image for the BullMQ worker — `ts-node-dev --respawn` reloads on
# source change. Uses bookworm-slim (not alpine) because Playwright's
# Chromium needs glibc + the libnss/libcups/etc. system libs.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libcairo2 libpango-1.0-0 \
    fontconfig fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
# System libs already installed above; use bare `playwright install` so
# we don't re-fetch deb packages (and don't fail if a transient apt mirror
# hiccup happens during build).
RUN npx playwright install chromium

COPY . .
RUN pnpm --filter api exec prisma generate

# Health endpoint port (worker exposes /health, /ready, /reap)
EXPOSE 3003
ENV CHOKIDAR_USEPOLLING=1

CMD ["pnpm", "--filter", "worker", "dev"]
