# ── Stage 1: playwright-base ──────────────────────────────────────────────────
# OS libraries + Chromium binaries (~700 MB). This is a stable layer — it
# only rebuilds when the Playwright version changes, NOT on every code push.
FROM node:20-bookworm-slim AS playwright-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium --with-deps

# ── Stage 2: deps ─────────────────────────────────────────────────────────────
FROM playwright-base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        ./apps/api/
COPY apps/web/package.json        ./apps/web/
COPY apps/worker/package.json     ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ── Stage 3: build ────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter worker build

# ── Stage 4: runtime ──────────────────────────────────────────────────────────
# Browsers from playwright-base + compiled output + node_modules from build.
# No TypeScript source, no build tooling.
FROM playwright-base AS runtime
WORKDIR /app

COPY --from=build /app/node_modules        ./node_modules
COPY --from=build /app/apps/worker/dist    ./apps/worker/dist
COPY --from=build /app/apps/api/prisma     ./apps/api/prisma
COPY --from=build /app/package.json        ./package.json
COPY --from=build /app/packages/shared     ./packages/shared

ENV NODE_ENV=production
EXPOSE 3003
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
