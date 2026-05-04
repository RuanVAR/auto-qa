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

ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
