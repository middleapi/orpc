# One Dockerfile, pick the target you need with --target
# Dev (Next default): docker build -t orpc-dev --target dev . && docker run -p 3000:3000 orpc-dev
# Next prod:           docker build -t orpc-next --target next-prod .
# Nuxt prod:           docker build -t orpc-nuxt --target nuxt-prod .
# SvelteKit prod:      docker build -t orpc-svelte --target svelte-prod .
# SolidStart prod:     docker build -t orpc-solid --target solid-prod .
# TanStack Start prod: docker build -t orpc-tanstack --target tanstack-prod .

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=10.24.0

# Base with pnpm installed
FROM node:${NODE_VERSION} AS base
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# Install dependencies with only manifest files (better cache)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json packages/*/
COPY playgrounds/*/package.json playgrounds/*/
RUN pnpm install --frozen-lockfile --prefer-offline

# Build shared packages once
FROM deps AS builder
COPY packages ./packages
COPY playgrounds ./playgrounds
RUN pnpm run build:packages

# --- App build stages (reuse deps + built packages) ---
FROM builder AS next-build
WORKDIR /app/playgrounds/next
RUN pnpm run build

FROM builder AS nuxt-build
WORKDIR /app/playgrounds/nuxt
RUN pnpm run build

FROM builder AS svelte-build
WORKDIR /app/playgrounds/svelte-kit
RUN pnpm run build

FROM builder AS solid-build
WORKDIR /app/playgrounds/solid-start
RUN pnpm run build

FROM builder AS tanstack-build
WORKDIR /app/playgrounds/tanstack-start
RUN pnpm run build

# --- Development (default target) ---
FROM deps AS dev
COPY packages ./packages
COPY playgrounds ./playgrounds
ENV NODE_ENV=development
WORKDIR /app/playgrounds/next
# Override this CMD to dev another playground (e.g. pnpm dev in nuxt)
CMD ["pnpm", "dev"]

# Helper to avoid repeating install steps in prod stages
FROM node:${NODE_VERSION} AS runtime-base
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json packages/*/

# --- Next.js production ---
FROM runtime-base AS next-prod
COPY playgrounds/next/package.json ./playgrounds/next/
# Install all deps (playground lists runtime deps in devDependencies)
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=next-build /app/packages ./packages
COPY --from=next-build /app/playgrounds/next/.next ./playgrounds/next/.next
COPY --from=next-build /app/playgrounds/next/public ./playgrounds/next/public
USER node
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/playgrounds/next
CMD ["pnpm", "start"]

# --- Nuxt production ---
FROM runtime-base AS nuxt-prod
COPY playgrounds/nuxt/package.json ./playgrounds/nuxt/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=nuxt-build /app/packages ./packages
COPY --from=nuxt-build /app/playgrounds/nuxt/.output ./playgrounds/nuxt/.output
USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/playgrounds/nuxt
CMD ["node", ".output/server/index.mjs"]

# --- SvelteKit production ---
FROM runtime-base AS svelte-prod
COPY playgrounds/svelte-kit/package.json ./playgrounds/svelte-kit/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=svelte-build /app/packages ./packages
COPY --from=svelte-build /app/playgrounds/svelte-kit/build ./playgrounds/svelte-kit/build
USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/playgrounds/svelte-kit
CMD ["node", "build"]

# --- SolidStart production ---
FROM runtime-base AS solid-prod
COPY playgrounds/solid-start/package.json ./playgrounds/solid-start/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=solid-build /app/packages ./packages
COPY --from=solid-build /app/playgrounds/solid-start/dist ./playgrounds/solid-start/dist
USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/playgrounds/solid-start
CMD ["node", "./dist/server"]

# --- TanStack Start production ---
FROM runtime-base AS tanstack-prod
COPY playgrounds/tanstack-start/package.json ./playgrounds/tanstack-start/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=tanstack-build /app/packages ./packages
COPY --from=tanstack-build /app/playgrounds/tanstack-start/dist ./playgrounds/tanstack-start/dist
USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/playgrounds/tanstack-start
CMD ["node", "./dist/server"]

# Default target
FROM dev
