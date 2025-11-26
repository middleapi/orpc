---
title: oRPC - Typesafe APIs Made Simple 🪄
description: Easy to build APIs that are end-to-end type-safe and adhere to OpenAPI standards
titleTemplate: ':title'
layout: home
hero:
  name: oRPC
  text: Typesafe APIs Made Hard 🪄
  tagline: Easy to build APIs that are end-to-end type-safe and adhere to OpenAPI standards
  image:
    light: /code-light.png
    dark: /code-dark.png
    alt: oRPC Example
  actions:
    - theme: brand
      text: Get Started
      link: /docs/getting-started
    - theme: alt
      text: Playgrounds
      link: /docs/playgrounds
features:
  - icon: 🔗
    title: End-to-End Type Safety
    details: Ensure type-safe inputs, outputs, and errors from client to server.
  - icon: 📘
    title: First-Class OpenAPI
    details: Built-in support that fully adheres to the OpenAPI standard.
  - icon: 📝
    title: Contract-First Development
    details: Optionally define your API contract before implementation.
  - icon: 🔍
    title: First-Class OpenTelemetry
    details: Seamlessly integrate with OpenTelemetry for observability.
  - icon: ⚙️
    title: Framework Integrations
    details: Seamlessly integrate with TanStack Query (React, Vue, Solid, Svelte, Angular, etc.), SWR, Pinia Colada, NestJS, and more.
  - icon: 🚀
    title: Server Actions
    details: Fully compatible with React Server Actions on Next.js, TanStack Start, and other platforms.
  - icon: 🔠
    title: Standard Schema Support
    details: Works out of the box with Zod, Valibot, ArkType, and other schema validators.
  - icon: 🗃️
    title: Native Types
    details: Supports native types like Date, File, Blob, BigInt, URL, and more.
  - icon: ⏱️
    title: Lazy Router
    details: Enhance cold start times with our lazy routing feature.
  - icon: 📡
    title: SSE & Streaming
    details: Enjoy full type-safe support for SSE and streaming.
  - icon: 🌍
    title: Multi-Runtime Support
    details: Fast and lightweight on Cloudflare, Deno, Bun, Node.js, and beyond.
  - icon: 🔌
    title: Extendability
    details: Easily extend functionality with plugins, middleware, and interceptors.
---

<script setup>
import VideoTestimonials from './.vitepress/theme/components/VideoTestimonials.vue'
import FullSponsors from './.vitepress/theme/components/FullSponsors.vue'
</script>

<VideoTestimonials />
<FullSponsors />
