FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium --with-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        ./apps/api/
COPY apps/web/package.json        ./apps/web/
COPY apps/worker/package.json     ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter worker build

ENV NODE_ENV=production
EXPOSE 3003
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
