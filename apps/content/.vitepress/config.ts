import { transformerTwoslash } from '@shikijs/vitepress-twoslash'
import { defineConfig } from 'vitepress'
import { groupIconMdPlugin, groupIconVitePlugin, localIconLoader } from 'vitepress-plugin-group-icons'
import llmstxt from 'vitepress-plugin-llms'

export default defineConfig({
  lang: 'en-US',
  title: 'oRPC - Typesafe APIs Made Simple 🪄',
  description: 'Easy to build APIs that are end-to-end type-safe and adhere to OpenAPI standards',
  lastUpdated: true,
  cleanUrls: true,
  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    config(md) {
      md.use(groupIconMdPlugin)
    },
    codeTransformers: [
      transformerTwoslash(),
    ],
  },
  themeConfig: {
    logo: '/logo.webp',
    siteTitle: '',
    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/unnoq/orpc' },
      { icon: 'discord', link: 'https://discord.gg/TXEbwRBvQn' },
      { icon: 'x', link: 'https://x.com/unnoqcom' },
      { icon: 'bluesky', link: 'https://bsky.app/profile/unnoq.com' },
    ],
    editLink: {
      pattern: 'https://github.com/unnoq/orpc/blob/main/apps/content/:path',
      text: 'Edit on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Unnoq & oRPC contributors.',
    },
    nav: [
      { text: 'Docs', link: '/docs/getting-started', activeMatch: '/docs/(?!openapi/)' },
      { text: 'OpenAPI', link: '/docs/openapi/getting-started', activeMatch: '/docs/openapi/' },
      { text: 'Examples', link: '/examples/openai-streaming', activeMatch: '/examples/' },
      { text: 'Blog', link: '/blog/v1-announcement', activeMatch: '/blog/' },
      {
        text: 'About',
        items: [
          { text: 'Sponsor', link: 'https://github.com/sponsors/unnoq' },
          { text: 'Releases', link: 'https://github.com/unnoq/orpc/releases' },
        ],
      },
      { text: 'Discussions', link: 'https://github.com/unnoq/orpc/discussions' },
    ],
    sidebar: {
      '/docs/': [
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'Procedure', link: '/docs/procedure' },
        { text: 'Router', link: '/docs/router' },
        { text: 'Middleware', link: '/docs/middleware' },
        { text: 'Context', link: '/docs/context' },
        { text: 'Error Handling', link: '/docs/error-handling' },
        { text: 'File Upload/Download', link: '/docs/file-upload-download' },
        { text: 'Event Iterator (SSE)', link: '/docs/event-iterator' },
        { text: 'Server Action', link: '/docs/server-action' },
        { text: 'Metadata', link: '/docs/metadata' },
        { text: 'RPC Handler', link: '/docs/rpc-handler' },
        { text: 'Lifecycle', link: '/docs/lifecycle' },
        { text: 'OpenAPI', link: '/docs/openapi/getting-started' },
        {
          text: 'Contract First',
          collapsed: true,
          items: [
            { text: 'Define Contract', link: '/docs/contract-first/define-contract' },
            { text: 'Implement Contract', link: '/docs/contract-first/implement-contract' },
          ],
        },
        {
          text: 'Adapters',
          collapsed: true,
          items: [
            { text: 'HTTP', link: '/docs/adapters/http' },
            { text: 'Websocket', link: '/docs/adapters/websocket' },
          ],
        },
        {
          text: 'Integrations',
          collapsed: true,
          items: [
            { text: 'Express', link: '/docs/integrations/express' },
            { text: 'Fastify', link: '/docs/integrations/fastify' },
            { text: 'Next.js', link: '/docs/integrations/next' },
            { text: 'Nuxt', link: '/docs/integrations/nuxt' },
            { text: 'Hono', link: '/docs/integrations/hono' },
            { text: 'Tanstack Start', link: '/docs/integrations/tanstack-start' },
            { text: 'Elysia', link: '/docs/integrations/elysia' },
            { text: 'SvelteKit', link: '/docs/integrations/svelte-kit' },
            { text: 'Remix', link: '/docs/integrations/remix' },
            { text: 'SolidStart', link: '/docs/integrations/solid-start' },
            { text: 'Astro', link: '/docs/integrations/astro' },
            { text: 'React Native', link: '/docs/integrations/react-native' },
          ],
        },
        {
          text: 'Plugins',
          collapsed: true,
          items: [
            { text: 'CORS', link: '/docs/plugins/cors' },
            { text: 'Response Headers', link: '/docs/plugins/response-headers' },
            { text: 'Batch Request/Response', link: '/docs/plugins/batch-request-response' },
            { text: 'Client Retry', link: '/docs/plugins/client-retry' },
            { text: 'Body Limit', link: '/docs/plugins/body-limit' },
            { text: 'Simple CSRF Protection', link: '/docs/plugins/simple-csrf-protection' },
            { text: 'Strict GET method', link: '/docs/plugins/strict-get-method' },
          ],
        },
        {
          text: 'Client',
          collapsed: true,
          items: [
            { text: 'Server-Side', link: '/docs/client/server-side' },
            { text: 'Client-Side', link: '/docs/client/client-side' },
            { text: 'Error Handling', link: '/docs/client/error-handling' },
            { text: 'Event Iterator', link: '/docs/client/event-iterator' },
            { text: 'RPC Link', link: '/docs/client/rpc-link' },
            { text: 'Dynamic Link', link: '/docs/client/dynamic-link' },
          ],
        },
        {
          text: 'Tanstack Query',
          collapsed: true,
          items: [
            { text: 'Basic', link: '/docs/tanstack-query/basic' },
            { text: 'React', link: '/docs/tanstack-query/react' },
            { text: 'Vue', link: '/docs/tanstack-query/vue' },
            { text: 'Solid', link: '/docs/tanstack-query/solid' },
            { text: 'Svelte', link: '/docs/tanstack-query/svelte' },
          ],
        },
        {
          text: 'Best Practices',
          collapsed: true,
          items: [
            { text: 'Dedupe Middleware', link: '/docs/best-practices/dedupe-middleware' },
            { text: 'No Throw Literal', link: '/docs/best-practices/no-throw-literal' },
            { text: 'Optimize SSR', link: '/docs/best-practices/optimize-ssr' },
          ],
        },
        {
          text: 'Advanced',
          collapsed: true,
          items: [
            { text: 'Validation Errors', link: '/docs/advanced/validation-errors' },
            { text: 'RPC Protocol', link: '/docs/advanced/rpc-protocol' },
            { text: 'RPC JSON Serializer', link: '/docs/advanced/rpc-json-serializer' },
            { text: 'Mocking', link: '/docs/advanced/mocking' },
            { text: 'Exceeds the maximum length ...', link: '/docs/advanced/exceeds-the-maximum-length-problem' },
            { text: 'SuperJson', link: '/docs/advanced/superjson' },
          ],
        },
        {
          text: 'Others',
          collapsed: true,
          items: [
            { text: 'Pinia Colada', link: '/docs/pinia-colada' },
            { text: 'NestJS', link: '/docs/openapi/nest/implement-contract' },
            { text: 'Playgrounds', link: '/docs/playgrounds' },
            { text: 'Comparison', link: '/docs/comparison' },
            { text: 'Ecosystem', link: '/docs/ecosystem' },
          ],
        },
      ],
      '/docs/openapi/': [
        { text: 'Getting Started', link: '/docs/openapi/getting-started' },
        { text: 'Routing', link: '/docs/openapi/routing' },
        { text: 'Input/Output Structure', link: '/docs/openapi/input-output-structure' },
        { text: 'Error Handling', link: '/docs/openapi/error-handling' },
        { text: 'Bracket Notation', link: '/docs/openapi/bracket-notation' },
        { text: 'OpenAPI Handler', link: '/docs/openapi/openapi-handler' },
        { text: 'OpenAPI Specification', link: '/docs/openapi/openapi-specification' },
        { text: 'Scalar (Swagger)', link: '/docs/openapi/scalar' },
        {
          text: 'Plugins',
          collapsed: true,
          items: [
            { text: 'OpenAPI Reference (Swagger)', link: '/docs/openapi/plugins/openapi-reference' },
            { text: 'Zod Smart Coercion', link: '/docs/openapi/plugins/zod-smart-coercion' },
          ],
        },
        {
          text: 'Client',
          collapsed: true,
          items: [
            { text: 'OpenAPI Link', link: '/docs/openapi/client/openapi-link' },
          ],
        },
        {
          text: 'NestJS',
          collapsed: true,
          items: [
            { text: 'Implement Contract', link: '/docs/openapi/nest/implement-contract' },
          ],
        },
        {
          text: 'Advanced',
          collapsed: true,
          items: [
            { text: 'Redirect Response', link: '/docs/openapi/advanced/redirect-response' },
            { text: 'OpenAPI JSON Serializer', link: '/docs/openapi/advanced/openapi-json-serializer' },
          ],
        },
      ],
      '/examples/': [
        { text: 'OpenAI Streaming', link: '/examples/openai-streaming' },
      ],
      '/blog/': [
        { text: 'V1 Announcement', link: '/blog/v1-announcement' },
      ],
    },
  },
  head: [
    ['meta', { property: 'og:image', content: 'https://orpc.unnoq.com/og.jpg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'twitter:domain', content: 'orpc.unnoq.com' }],
    ['meta', { property: 'twitter:image', content: 'https://orpc.unnoq.com/og.jpg' }],
    ['meta', { property: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'shortcut icon', href: '/icon.svg', type: 'image/svg+xml' }],
  ],
  titleTemplate: ':title - oRPC',
  vite: {
    plugins: [
      llmstxt(),
      groupIconVitePlugin({
        customIcon: {
          cloudflare: 'logos:cloudflare-workers-icon',
          node: localIconLoader(import.meta.url, './assets/nodejs-logo-icon.svg'),
        },
      }),
    ],
  },
})
