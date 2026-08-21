# syntax=docker/dockerfile:1

# --- build stage -------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --ignore-workspace --frozen-lockfile

COPY . .
RUN pnpm build

# --- runtime stage -------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.mjs ./server.mjs

EXPOSE 4321
CMD ["node", "server.mjs"]
