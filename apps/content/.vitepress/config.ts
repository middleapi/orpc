import { transformerTwoslash } from '@shikijs/vitepress-twoslash'
import markdownItTaskLists from 'markdown-it-task-lists'
import { defineConfig } from 'vitepress'
import { groupIconMdPlugin, groupIconVitePlugin, localIconLoader } from 'vitepress-plugin-group-icons'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
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
      md.use(markdownItTaskLists)
      md.use(copyOrDownloadAsMarkdownButtons)
    },
    codeTransformers: [
      transformerTwoslash(),
    ],
  },
  sitemap: {
    hostname: 'https://orpc.unnoq.com',
    lastmodDateOnly: true,
  },
  themeConfig: {
    logo: '/logo.webp',
    siteTitle: '',
    search: {
      provider: 'local',
      options: {
        detailedView: true,
        miniSearch: {
          searchOptions: {
            boostDocument(docId: string) {
              if (docId.startsWith('/learn-and-contribute/')) {
                return 0.5
              }

              return 1
            },
          },
        },
      },
    },
    carbonAds: {
      code: 'CW7IE53J',
      placement: 'orpcunnoqcom',
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
      { text: 'Blog', link: '/blog/v1-announcement', activeMatch: '/blog/' },
      { text: 'Learn & Contribute', link: '/learn-and-contribute/overview', activeMatch: '/learn-and-contribute/' },
      {
        text: 'More',
        items: [
          { text: 'Discussions', link: 'https://github.com/unnoq/orpc/discussions' },
          { text: 'Sponsor', link: 'https://github.com/sponsors/unnoq' },
          { text: 'Releases', link: 'https://github.com/unnoq/orpc/releases' },
          { text: 'LLM Context', link: '/llms.txt' },
          { text: 'LLM Context (Full)', link: '/llms-full.txt' },
        ],
      },
    ],
    sidebar: {
      '/docs/': [
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'Comparison', link: '/docs/comparison' },
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
        { text: 'OpenAPI', link: '/docs/openapi/getting-started' },
        { text: 'Ecosystem', link: '/docs/ecosystem' },
        { text: 'Playgrounds', link: '/docs/playgrounds' },
        {
          text: 'Contract First',
          collapsed: true,
          items: [
            { text: 'Define Contract', link: '/docs/contract-first/define-contract' },
            { text: 'Implement Contract', link: '/docs/contract-first/implement-contract' },
            { text: 'Router to Contract', link: '/docs/contract-first/router-to-contract' },
          ],
        },
        {
          text: 'Adapters',
          collapsed: true,
          items: [
            { text: 'HTTP', link: '/docs/adapters/http' },
            { text: 'Websocket', link: '/docs/adapters/websocket' },
            { text: 'Message Port', link: '/docs/adapters/message-port' },
            { text: '---' },
            { text: 'Astro', link: '/docs/adapters/astro' },
            { text: 'Browser', link: '/docs/adapters/browser' },
            { text: 'Electron', link: '/docs/adapters/electron' },
            { text: 'Elysia', link: '/docs/adapters/elysia' },
            { text: 'Express', link: '/docs/adapters/express' },
            { text: 'Fastify', link: '/docs/adapters/fastify' },
            { text: 'H3', link: '/docs/adapters/h3' },
            { text: 'Hono', link: '/docs/adapters/hono' },
            { text: 'Next.js', link: '/docs/adapters/next' },
            { text: 'Nuxt', link: '/docs/adapters/nuxt' },
            { text: 'React Native', link: '/docs/adapters/react-native' },
            { text: 'Remix', link: '/docs/adapters/remix' },
            { text: 'Solid Start', link: '/docs/adapters/solid-start' },
            { text: 'Svelte Kit', link: '/docs/adapters/svelte-kit' },
            { text: 'Tanstack Start', link: '/docs/adapters/tanstack-start' },
            { text: 'Web Workers', link: '/docs/adapters/web-workers' },
            { text: 'Worker Threads', link: '/docs/adapters/worker-threads' },
          ],
        },
        {
          text: 'Plugins',
          collapsed: true,
          items: [
            { text: 'CORS', link: '/docs/plugins/cors' },
            { text: 'Request Headers', link: '/docs/plugins/request-headers' },
            { text: 'Response Headers', link: '/docs/plugins/response-headers' },
            { text: 'Request Validation', link: '/docs/plugins/request-validation' },
            { text: 'Response Validation', link: '/docs/plugins/response-validation' },
            { text: 'Hibernation', link: '/docs/plugins/hibernation' },
            { text: 'Dedupe Requests', link: '/docs/plugins/dedupe-requests' },
            { text: 'Batch Requests', link: '/docs/plugins/batch-requests' },
            { text: 'Client Retry', link: '/docs/plugins/client-retry' },
            { text: 'Compression', link: '/docs/plugins/compression' },
            { text: 'Body Limit', link: '/docs/plugins/body-limit' },
            { text: 'Simple CSRF Protection', link: '/docs/plugins/simple-csrf-protection' },
            { text: 'Strict GET method', link: '/docs/plugins/strict-get-method' },
          ],
        },
        {
          text: 'Helpers',
          collapsed: true,
          items: [
            { text: 'Base64Url', link: '/docs/helpers/base64url' },
            { text: 'Cookie', link: '/docs/helpers/cookie' },
            { text: 'Encryption', link: '/docs/helpers/encryption' },
            { text: 'Form Data', link: '/docs/helpers/form-data' },
            { text: 'Publisher', link: '/docs/helpers/publisher' },
            { text: 'Ratelimit', link: '/docs/helpers/ratelimit' },
            { text: 'Signing', link: '/docs/helpers/signing' },
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
          text: 'Integrations',
          collapsed: true,
          items: [
            { text: 'AI SDK', link: '/docs/integrations/ai-sdk' },
            { text: 'Better Auth', link: '/docs/integrations/better-auth' },
            { text: 'Durable Iterator', link: '/docs/integrations/durable-iterator' },
            { text: 'Hey API', link: '/docs/integrations/hey-api' },
            { text: 'OpenTelemetry', link: '/docs/integrations/opentelemetry' },
            { text: 'Pinia Colada', link: '/docs/integrations/pinia-colada' },
            { text: 'React SWR', link: '/docs/integrations/react-swr' },
            { text: 'Sentry', link: '/docs/integrations/sentry' },
            { text: 'Tanstack Query', link: '/docs/integrations/tanstack-query' },
            {
              text: 'Tanstack Query (Old)',
              collapsed: true,
              items: [
                { text: 'Basic', link: '/docs/integrations/tanstack-query-old/basic' },
                { text: 'React', link: '/docs/integrations/tanstack-query-old/react' },
                { text: 'Vue', link: '/docs/integrations/tanstack-query-old/vue' },
                { text: 'Solid', link: '/docs/integrations/tanstack-query-old/solid' },
                { text: 'Svelte', link: '/docs/integrations/tanstack-query-old/svelte' },
              ],
            },
            { text: 'NestJS', link: '/docs/openapi/integrations/implement-contract-in-nest' },
            { text: 'tRPC', link: '/docs/openapi/integrations/trpc' },
          ],
        },
        {
          text: 'Examples',
          collapsed: true,
          items: [
            { text: 'OpenAI Streaming', link: '/docs/examples/openai-streaming' },
          ],
        },
        {
          text: 'Best Practices',
          collapsed: true,
          items: [
            { text: 'Dedupe Middleware', link: '/docs/best-practices/dedupe-middleware' },
            { text: 'Monorepo Setup', link: '/docs/best-practices/monorepo-setup' },
            { text: 'No Throw Literal', link: '/docs/best-practices/no-throw-literal' },
            { text: 'Optimize SSR', link: '/docs/best-practices/optimize-ssr' },
          ],
        },
        {
          text: 'Advanced',
          collapsed: true,
          items: [
            { text: 'Building Custom Plugins', link: '/docs/advanced/building-custom-plugins' },
            { text: 'Exceeds the maximum length ...', link: '/docs/advanced/exceeds-the-maximum-length-problem' },
            { text: 'Extend Body Parser', link: '/docs/advanced/extend-body-parser' },
            { text: 'Publish Client to NPM', link: '/docs/advanced/publish-client-to-npm' },
            { text: 'RPC JSON Serializer', link: '/docs/advanced/rpc-json-serializer' },
            { text: 'RPC Protocol', link: '/docs/advanced/rpc-protocol' },
            { text: 'SuperJson', link: '/docs/advanced/superjson' },
            { text: 'Testing & Mocking', link: '/docs/advanced/testing-mocking' },
            { text: 'Validation Errors', link: '/docs/advanced/validation-errors' },
          ],
        },
        {
          text: 'Migrations',
          collapsed: true,
          items: [
            { text: 'Migrating from tRPC', link: '/docs/migrations/from-trpc' },
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
            { text: 'Smart Coercion', link: '/docs/openapi/plugins/smart-coercion' },
            { text: 'Zod Smart Coercion (old)', link: '/docs/openapi/plugins/zod-smart-coercion' },
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
          text: 'Integrations',
          collapsed: true,
          items: [
            { text: 'Implement Contract in NestJS', link: '/docs/openapi/integrations/implement-contract-in-nest' },
            { text: 'tRPC', link: '/docs/openapi/integrations/trpc' },
          ],
        },
        {
          text: 'Advanced',
          collapsed: true,
          items: [
            { text: 'Customizing Error Response', link: '/docs/openapi/advanced/customizing-error-response' },
            { text: 'Disabling Output Validation', link: '/docs/openapi/advanced/disabling-output-validation' },
            { text: 'Expanding Type Support for OpenAPI Link', link: '/docs/openapi/advanced/expanding-type-support-for-openapi-link' },
            { text: 'OpenAPI JSON Serializer', link: '/docs/openapi/advanced/openapi-json-serializer' },
            { text: 'Redirect Response', link: '/docs/openapi/advanced/redirect-response' },
          ],
        },
      ],
      '/blog/': [
        { text: 'V1 Announcement', link: '/blog/v1-announcement' },
      ],
      '/learn-and-contribute/': [
        { text: 'Overview', link: '/learn-and-contribute/overview' },
        {
          text: 'Mini oRPC',
          items: [
            { text: '0. Overview', link: '/learn-and-contribute/mini-orpc/overview' },
            { text: '1. Procedure Builder', link: '/learn-and-contribute/mini-orpc/procedure-builder' },
            { text: '2. Server-side Client', link: '/learn-and-contribute/mini-orpc/server-side-client' },
            { text: '3. Client-side Client', link: '/learn-and-contribute/mini-orpc/client-side-client' },
            { text: '4. Beyond the Basics', link: '/learn-and-contribute/mini-orpc/beyond-the-basics' },
          ],
        },
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
    ['script', {}, `
      !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init be ys Ss me gs ws capture Ne calculateEventProperties xs register register_once register_for_session unregister unregister_for_session Rs getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Is ks createPersonProfile Ps bs opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing $s debug Es getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
      posthog.init('phc_YHeqjC9tR604AHH45kQi63fT4aBvpsS7zAaCxntBzZm', {
          api_host: 'https://us.i.posthog.com',
          person_profiles: 'always',
      })
    `],
  ],
  titleTemplate: ':title - oRPC',
  vite: {
    plugins: [
      llmstxt({
        ignoreFiles: [
          'blog/*',
          'learn-and-contribute/*',
        ],
      }),
      groupIconVitePlugin({
        customIcon: {
          cloudflare: 'logos:cloudflare-workers-icon',
          node: localIconLoader(import.meta.url, './assets/nodejs-logo-icon.svg'),
        },
      }),
    ],
  },
}))
