# Docker Deployment Guide

This guide explains how to use Docker to deploy and run the oRPC project and its playgrounds.

## Prerequisites

- Docker installed on your machine
- Docker Compose (for running multiple services)

## Quick Start

### Development Mode

To run a specific playground in development mode:

```bash
# Next.js (default dev target)
docker compose --profile next up

# Nuxt
docker compose --profile nuxt up

# SvelteKit
docker compose --profile svelte up

# SolidStart
docker compose --profile solid up

# TanStack Start
docker compose --profile tanstack up
```

### Production Mode

To run a specific playground in production mode:

```bash
# Next.js Production
docker compose --profile production-next up

# Nuxt Production
docker compose --profile production-nuxt up

# SvelteKit Production
docker compose --profile production-svelte up

# SolidStart Production
docker compose --profile production-solid up

# TanStack Start Production
docker compose --profile production-tanstack up
```

## Manual Docker Build

Single `Dockerfile` with multiple targets:

- `dev` (default): development image (Next dev command by default)
- `next-prod`, `nuxt-prod`, `svelte-prod`, `solid-prod`, `tanstack-prod`: production images per playground

### Build the dev image (default target)

```bash
docker build -t orpc-dev .
```

### Run Development Container

```bash
docker run -it --rm -p 3000:3000 -v $(pwd)/playgrounds/next:/app/playgrounds/next orpc-dev pnpm --filter next dev
```

### Build and Run Production

```bash
# Next.js
docker build --target next-prod -t orpc-next .
docker run -d -p 3000:3000 --name orpc-next orpc-next

# Nuxt
docker build --target nuxt-prod -t orpc-nuxt .
docker run -d -p 3000:3000 --name orpc-nuxt orpc-nuxt

# SvelteKit
docker build --target svelte-prod -t orpc-svelte .

# SolidStart
docker build --target solid-prod -t orpc-solid .

# TanStack Start
docker build --target tanstack-prod -t orpc-tanstack .
```

## Multi-stage Builds Explained

The single Dockerfile works in layers:

1) `base` / `deps`: install pnpm and workspace dependencies using only manifest files (better cache).
2) `builder`: copy source and build shared packages.
3) `[framework]-build`: build each playground once using the shared artifacts.
4) `[framework]-prod`: copy only the built output + packages and run as the `node` user.

## Environment Variables

- `NODE_ENV`: Set to `development` or `production`
- `PORT`: The port the application should run on (default: 3000)

## Volumes in Development

Development configurations use volumes to enable hot reloading:

- Source code is mounted from your local filesystem
- Node modules are isolated to prevent conflicts between host and container

## Customization

To add your own application:

1. Add your app to the `playgrounds` directory
2. Add a new target stage in the Dockerfile following the existing pattern
3. Add a new service in docker-compose.yml

## Health Checks

You can add health checks to your docker-compose.yml:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Cleanup

To remove all containers and images:

```bash
docker compose down --rmi all
```

## Image Size Optimization

1. Keep `.dockerignore` up to date (you can swap in `.dockerignore.optimized` if you want to exclude more).
2. Build only the target you need: `docker build --target next-prod ...`.
3. For smaller prod images later, we can add per-app `pnpm --filter ... --prod` installs or standalone outputs.
