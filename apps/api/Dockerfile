# ── Stage 1: deps ─────────────────────────────────────────────────────────────
# Install ALL workspace dependencies. This layer is cached as long as the
# lock-file and package.json manifests don't change — even across code edits.
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json        ./apps/api/
COPY apps/web/package.json        ./apps/web/
COPY apps/worker/package.json     ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────────────────
# Compile TypeScript and generate the Prisma client. Source files only live
# in this intermediate stage — they never land in the runtime image.
FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate
RUN pnpm --filter api build

# ── Stage 3: runtime ──────────────────────────────────────────────────────────
# Lean image: compiled output + node_modules from build stage (includes the
# generated Prisma client in pnpm's virtual store). No TypeScript source,
# no build tooling, no test files.
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=build /app/node_modules        ./node_modules
COPY --from=build /app/apps/api/dist       ./apps/api/dist
COPY --from=build /app/apps/api/prisma     ./apps/api/prisma
COPY --from=build /app/package.json        ./package.json
COPY --from=build /app/packages/shared     ./packages/shared

ENV NODE_ENV=production
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["node", "dist/main"]
