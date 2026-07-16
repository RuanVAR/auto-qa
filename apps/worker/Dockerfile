FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 \
    fontconfig fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        ./apps/api/
COPY apps/web/package.json        ./apps/web/
COPY apps/worker/package.json     ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage/package.json ./packages/storage/
RUN pnpm install --frozen-lockfile
# Install chromium AFTER pnpm install so the binary version matches the
# locked Playwright version. If `npx playwright install` runs before pnpm
# install (as it did previously), it downloads whatever chromium the latest
# `playwright` npm package wants — which can diverge from the locked
# package version, leading to "Executable doesn't exist" at runtime.
RUN pnpm --filter worker exec playwright install chromium
COPY . .
# Build the workspace packages first — the worker imports their compiled dist
# (shared: secret-box; storage: artifact drivers).
RUN pnpm --filter @qa-platform/shared build
RUN pnpm --filter @qa-platform/storage build
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter worker build

ENV NODE_ENV=production
EXPOSE 3003
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
