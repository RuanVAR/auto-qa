FROM node:20-alpine AS build
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .

# Vite bakes `import.meta.env.VITE_API_URL` into the bundle at BUILD TIME, so
# we set it as a build arg. Default empty string → axios uses relative URLs
# → browser hits the same origin → nginx (in this image) proxies /api/* and
# /socket.io/* to the api container. That's the right default for self-hosted
# deploys; same origin avoids CORS entirely.
#
# Override via:
#   docker build --build-arg VITE_API_URL=https://api.example.com ...
# only if api is hosted on a different origin than web (rare). In that case
# you'll also need to enable CORS on the api side.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter web build
FROM nginx:alpine AS runner
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx","-g","daemon off;"]
