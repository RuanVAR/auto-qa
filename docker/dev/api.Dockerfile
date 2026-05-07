# Dev image — runs `nest start --watch` so file edits inside the bind-
# mounted source tree trigger an automatic rebuild + restart. NOT for prod;
# the production Dockerfile builds dist/ and runs `node dist/main`.
#
# bookworm-slim instead of alpine: Prisma's musl/openssl engine binaries
# need libssl1.1 which Alpine 3.18+ no longer ships. Debian's libssl3 is
# compatible with Prisma's `linux-debian` engine variant out of the box.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    openssl ca-certificates \
    # Playwright/Chromium runtime deps — needed because the API renders
    # PDF reports server-side via Playwright (ReportsService.renderPdf).
    # Without these libs Chromium fails to launch with "shared object not
    # found" errors and PDF generation returns 500.
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10

WORKDIR /app

# Install dependencies separately so layer cache invalidates only when
# package files change, not on every source edit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# Install the Chromium binary that Playwright drives. We skip --with-deps
# because the system libs are already installed above (and --with-deps
# triggers an apt-get that sometimes fails on transient mirror hiccups).
RUN npx playwright install chromium

# Source is bind-mounted at runtime (see docker/dev/docker-compose.yml). The
# COPY below seeds the image with the current source so first boot has something
# to compile while bind mounts settle. Bind mount overrides this on start.
COPY . .

RUN pnpm --filter api exec prisma generate

EXPOSE 3001
# CHOKIDAR_USEPOLLING — chokidar (used by nest --watch) needs polling on
# bind mounts because inotify doesn't propagate through the Docker fs layer
# reliably on macOS / WSL. ~1s detection latency is the tradeoff for
# universal reliability.
ENV CHOKIDAR_USEPOLLING=1
ENV WATCHPACK_POLLING=true

CMD ["pnpm", "--filter", "api", "dev"]
