# Dev image — runs Vite's dev server with HMR. Source is bind-mounted at
# runtime so edits in your editor trigger immediate reload in the browser.
FROM node:20-alpine

RUN apk add --no-cache bash
RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3000
ENV CHOKIDAR_USEPOLLING=1

# `--host 0.0.0.0` is handled by apps/web/vite.config.ts (`host: true`) so
# the mapped port remains reachable from the host.
CMD ["pnpm", "--filter", "web", "dev"]
