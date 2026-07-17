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
  ignoreDeadLinks: true, // TODO: turn off this flag
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
    hostname: 'https://orpc.dev',
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
    socialLinks: [
      { icon: 'github', link: 'https://github.com/middleapi/orpc' },
      { icon: 'discord', link: 'https://discord.gg/TXEbwRBvQn' },
      { icon: 'x', link: 'https://x.com/middleapi' },
      { icon: 'bluesky', link: 'https://bsky.app/profile/middleapi.com' },
    ],
    editLink: {
      pattern: 'https://github.com/middleapi/orpc/blob/main/apps/content/:path',
      text: 'Edit on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present MiddleAPI & oRPC contributors.',
    },
    nav: [
      { text: 'Docs', link: '/docs/getting-started', activeMatch: '/docs/' },
      { text: 'Blog', link: '/blog/v1-announcement', activeMatch: '/blog/' },
      { text: 'Learn & Contribute', link: '/learn-and-contribute/overview', activeMatch: '/learn-and-contribute/' },
      {
        text: 'More',
        items: [
          { text: 'Discussions', link: 'https://github.com/middleapi/orpc/discussions' },
          { text: 'Sponsor', link: 'https://github.com/sponsors/dinwwwh' },
          { text: 'Releases', link: 'https://github.com/middleapi/orpc/releases' },
          { text: 'LLM Context', link: '/llms.txt' },
          { text: 'LLM Context (Full)', link: '/llms-full.txt' },
        ],
      },
    ],
    sidebar: {
      '/docs/': [
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'Procedure', link: '/docs/procedure' },
        { text: 'Router', link: '/docs/router' },
        { text: 'Middleware', link: '/docs/middleware' },
        { text: 'Context', link: '/docs/context' },
        { text: 'Error Handling', link: '/docs/error-handling' },
        { text: 'Binary Data', link: '/docs/binary-data' },
        { text: 'AsyncIteratorObject (SSE)', link: '/docs/async-iterator-object' },
        { text: 'Metadata', link: '/docs/metadata' },
        { text: 'Playgrounds', link: '/docs/playgrounds' },
        {
          text: 'RPC',
          collapsed: true,
          items: [
            { text: 'RPC Protocol', link: '/docs/rpc/protocol' },
            { text: 'RPC Serializer', link: '/docs/rpc/serializer' },
            { text: 'RPC Handler', link: '/docs/rpc/handler' },
            { text: 'RPC Link', link: '/docs/rpc/link' },
          ],
        },
        {
          text: 'OpenAPI',
          collapsed: true,
          items: [
            { text: 'OpenAPI Routing', link: '/docs/openapi/routing' },
            { text: 'Input and Output Mapping', link: '/docs/openapi/input-and-output-mapping' },
            { text: 'Bracket Notation', link: '/docs/openapi/bracket-notation' },
            { text: 'OpenAPI Serializer', link: '/docs/openapi/serializer' },
            { text: 'OpenAPI Handler', link: '/docs/openapi/handler' },
            { text: 'OpenAPI Link', link: '/docs/openapi/link' },
            { text: 'OpenAPI Specification', link: '/docs/openapi/specification' },
            { text: 'OpenAPI Scalar (Swagger)', link: '/docs/openapi/scalar' },
          ],
        },
        {
          text: 'Contract',
          collapsed: true,
          items: [
            { text: 'Procedure Contract', link: '/docs/contract/procedure' },
            { text: 'Router Contract', link: '/docs/contract/router' },
            { text: 'Contract Implementation', link: '/docs/contract/implementation' },
          ],
        },
        {
          text: 'Client',
          collapsed: true,
          items: [
            { text: 'Server-Side', link: '/docs/client/server-side' },
            { text: 'Client-Side', link: '/docs/client/client-side' },
            { text: 'Error Handling', link: '/docs/client/error-handling' },
            { text: 'AsyncIteratorObject (SSE)', link: '/docs/client/async-iterator-object' },
            { text: 'Dynamic Link', link: '/docs/client/dynamic-link' },
          ],
        },
        {
          text: 'Adapters',
          collapsed: true,
          items: [
            { text: 'Fetch API', link: '/docs/adapters/fetch-api' },
            { text: 'Node HTTP', link: '/docs/adapters/node-http' },
            { text: 'WebSocket', link: '/docs/adapters/websocket' },
            { text: 'Message Port', link: '/docs/adapters/message-port' },
            { text: '---' },
            { text: 'React Native', link: '/docs/adapters/react-native' },
          ],
        },
        {
          text: 'Plugins',
          collapsed: true,
          items: [
            { text: 'Batch', link: '/docs/plugins/batch' },
            { text: 'CORS', link: '/docs/plugins/cors' },
            { text: 'CSRF Guard', link: '/docs/plugins/csrf-guard' },
            { text: 'Dedupe', link: '/docs/plugins/dedupe' },
            { text: 'OpenAPI Reference', link: '/docs/plugins/openapi-reference' },
            { text: 'Request Compression', link: '/docs/plugins/request-compression' },
            { text: 'Request Headers', link: '/docs/plugins/request-headers' },
            { text: 'Request Limit', link: '/docs/plugins/request-limit' },
            { text: 'Request Validation', link: '/docs/plugins/request-validation' },
            { text: 'Response Compression', link: '/docs/plugins/response-compression' },
            { text: 'Response Headers', link: '/docs/plugins/response-headers' },
            { text: 'Response Validation', link: '/docs/plugins/response-validation' },
            { text: 'Rethrow', link: '/docs/plugins/rethrow' },
            { text: 'Retry After', link: '/docs/plugins/retry-after' },
            { text: 'Retry', link: '/docs/plugins/retry' },
            { text: 'Smart Coercion', link: '/docs/plugins/smart-coercion' },
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
          text: 'Integrations',
          collapsed: true,
          items: [
            { text: 'Effect', link: '/docs/integrations/effect' },
            { text: 'Evlog', link: '/docs/integrations/evlog' },
            { text: 'NestJS', link: '/docs/integrations/nest' },
            { text: 'Next.js', link: '/docs/integrations/next' },
            { text: 'OpenTelemetry', link: '/docs/integrations/opentelemetry' },
            { text: 'Pino', link: '/docs/integrations/pino' },
            { text: 'Tanstack Query', link: '/docs/integrations/tanstack-query' },
          ],
        },
        {
          text: 'Extensions',
          collapsed: true,
          items: [
            { text: '.callable', link: '/docs/client/server-side#callable-extension' },
            { text: '.route', link: '/docs/openapi/routing#callable-extension' },
            { text: '.actionable', link: '/docs/integrations/next#actionable-extension' },
            { text: '.effect', link: '/docs/integrations/effect#effect-extension' },
          ],
        },
        {
          text: 'Best Practices',
          collapsed: true,
          items: [
            { text: 'Dedupe Middleware', link: '/docs/best-practices/dedupe-middleware' },
            { text: 'Monorepo Setup', link: '/docs/best-practices/monorepo-setup' },
            { text: 'No Throw Literal', link: '/docs/best-practices/no-throw-literal' },
            { text: 'Optimizing SSR', link: '/docs/best-practices/optimizing-ssr' },
          ],
        },
        {
          text: 'Advanced',
          collapsed: true,
          items: [
            { text: 'Exceeds the maximum length ...', link: '/docs/advanced/exceeds-the-maximum-length-problem' },
            { text: 'Expanding Type Support for OpenAPI Link', link: '/docs/advanced/expanding-type-support-for-openapi-link' },
            { text: 'Publish Client to NPM', link: '/docs/advanced/publish-client-to-npm' },
            { text: 'Scaling Large Projects', link: '/docs/advanced/scaling-large-projects' },
            { text: 'Testing and Mocking', link: '/docs/advanced/testing-and-mocking' },
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
    ['meta', { property: 'og:image', content: 'https://orpc.dev/og.jpg' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'twitter:domain', content: 'orpc.dev' }],
    ['meta', { property: 'twitter:image', content: 'https://orpc.dev/og.jpg' }],
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
