FROM node:20-bookworm-slim AS base
RUN npm install -g pnpm@10
RUN apt-get update && apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
RUN npx playwright install chromium --with-deps
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter worker build
# Produce a self-contained flat node_modules with no pnpm symlinks
RUN pnpm deploy --filter worker /app/worker-deploy

FROM base AS runner
WORKDIR /app
COPY --from=base /app/worker-deploy/node_modules ./node_modules
COPY --from=base /app/apps/worker/dist ./dist
COPY --from=base /root/.cache/ms-playwright /root/.cache/ms-playwright
ENV NODE_ENV=production
CMD ["node","dist/main.js"]
