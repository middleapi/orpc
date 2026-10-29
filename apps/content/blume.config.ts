import { fileURLToPath } from 'node:url'
import { defineConfig } from 'blume'
import { posthog } from 'blume/analytics'
import { cloudflare } from 'blume/deploy'
import { filesystem } from 'blume/sources'
import { serverSourcemapsPlugin } from './dev/server-sourcemaps'
import { searchCodeIndexPlugin } from './search/code-index'
import { sponsorAdsInjectPlugin } from './sponsors/inject'

export default defineConfig({
  title: 'oRPC',
  description: 'Build end-to-end typesafe APIs and serve them over RPC, OpenAPI, and MCP',
  logo: '/logo.svg',
  banner: {
    content: 'You are reading the v2 docs, currently in beta.',
    link: { href: 'https://v1.orpc.dev', text: 'V1 docs' },
    dismissible: true,
  },
  content: {
    sources: [
      filesystem({
        root: '.',
        include: [
          'docs/**/*.{md,mdx}',
          'blog/**/*.{md,mdx}',
        ],
      }),
    ],
  },
  github: {
    owner: 'middleapi',
    repo: 'orpc',
    dir: 'apps/content',
  },
  theme: {
    // Brand pink from the logo mark (#ff6ca5 = oklch(0.727 0.187 359)).
    // Light mode darkens it so white accent text keeps AA contrast; dark
    // mode uses the true brand pink (its text flips dark in theme.css).
    accent: { light: 'oklch(0.58 0.19 359)', dark: '#ff6ca5' },
    // Zed's dark editor/content ground (#282c33 is only its sidebar color);
    // the rest of the palette lives in theme.css.
    background: { dark: '#0d1016' },
    fonts: {
      display: 'inter',
      body: 'inter',
    },
  },
  lastModified: 'git',
  navigation: {
    // The owned header (components/blume/Header.astro) links the repository.
    // Blume would also put it in a site footer below every page, as that
    // footer's only content, so leave it out and the footer doesn't render.
    repo: false,
    sidebar: {
      display: 'group',
    },
    tabs: [
      { label: 'Documentation', path: '/docs' },
      { label: 'Blog', path: '/blog', href: '/blog' },
      { label: 'Comparison', path: '/docs', href: '/docs/comparison' },
      { label: 'From V1', path: '/docs', href: '/docs/migrations/from-v1' },
      { label: 'Sponsors', path: '/sponsors', href: '/sponsors' },
      { label: 'Experts', path: '/experts', href: '/experts' },
      {
        label: 'More',
        path: '',
        items: [
          { label: 'Releases', path: 'https://github.com/middleapi/orpc/releases' },
          { label: 'Discussions', path: 'https://github.com/middleapi/orpc/discussions' },
          { label: 'LLM Context', path: 'https://orpc.dev/llms.txt' },
          { label: 'LLM Context (Full)', path: 'https://orpc.dev/llms-full.txt' },
          { label: 'V1 Documentation', path: 'https://v1.orpc.dev' },
        ],
      },
    ],
  },
  analytics: [
    posthog({
      /** Reverse proxy on our own domain, so ad blockers don't drop events. */
      host: 'https://poho.orpc.dev',
      key: 'phc_YHeqjC9tR604AHH45kQi63fT4aBvpsS7zAaCxntBzZm',
      /** A reverse proxy requires `ui_host` (forwarded to `posthog.init`). */
      ui_host: 'https://us.posthog.com',
    }),
  ],

  seo: {
    /** The publisher of every page's JSON-LD: the team behind oRPC, not the product itself. */
    organization: {
      name: 'middleapi',
      url: 'https://github.com/middleapi',
      sameAs: [
        'https://x.com/middleapi',
        'https://opencollective.com/middleapi',
      ],
    },
    /** The homepage's SoftwareApplication JSON-LD node, which tells search engines and agents what oRPC is. */
    software: {
      license: 'https://github.com/middleapi/orpc/blob/main/LICENSE',
      operatingSystem: 'Cross-platform',
      price: 0,
      sameAs: [
        'https://github.com/middleapi/orpc',
        'https://www.npmjs.com/package/@orpc/server',
        'https://www.npmjs.com/package/@orpc/client',
      ],
    },
    x: { creator: '@middleapi', handle: '@middleapi' },
    og: {
      titles: {
        '/': 'Typesafe APIs Made Simple',
      },
    },
  },
  /** v1 URLs Google still indexes, pointed at their v2 counterparts. */
  redirects: [
    { from: '/docs/adapters/http', to: '/docs/adapters/fetch-api' },

    { from: '/docs/contract-first/define-contract', to: '/docs/contract/procedure' },
    { from: '/docs/contract-first/implement-contract', to: '/docs/contract/implementation' },
    { from: '/docs/contract-first/router-to-contract', to: '/docs/contract/router' },
    { from: '/docs/advanced/scaling-large-projects', to: '/docs/contract/client-factory' },
    { from: '/docs/openapi/openapi-to-contract', to: '/docs/contract/generate-from-openapi' },

    { from: '/docs/advanced/exceeds-the-maximum-length-problem', to: '/docs/recipes/exceeds-the-maximum-length-problem' },
    { from: '/docs/advanced/publish-client-to-npm', to: '/docs/recipes/publish-client-to-npm' },
    { from: '/docs/advanced/testing-mocking', to: '/docs/recipes/testing-and-mocking' },
    { from: '/docs/advanced/validation-errors', to: '/docs/recipes/validation-customization' },
    { from: '/docs/openapi/advanced/disabling-output-validation', to: '/docs/recipes/validation-customization' },
    { from: '/docs/best-practices/dedupe-middleware', to: '/docs/recipes/dedupe-middleware' },
    { from: '/docs/best-practices/monorepo-setup', to: '/docs/recipes/monorepo-setup' },
    { from: '/docs/best-practices/no-throw-literal', to: '/docs/recipes/no-throw-literal' },
    { from: '/docs/best-practices/optimize-ssr', to: '/docs/recipes/optimizing-ssr' },

    { from: '/docs/rpc-handler', to: '/docs/rpc/handler' },
    { from: '/docs/client/rpc-link', to: '/docs/rpc/link' },
    { from: '/docs/advanced/rpc-protocol', to: '/docs/rpc/protocol' },
    { from: '/docs/advanced/rpc-json-serializer', to: '/docs/rpc/serializer' },

    { from: '/docs/openapi/getting-started', to: '/docs/openapi/routing' },
    { from: '/docs/openapi/openapi-handler', to: '/docs/openapi/handler' },
    { from: '/docs/openapi/error-handling', to: '/docs/openapi/handler' },
    { from: '/docs/openapi/advanced/customizing-error-response', to: '/docs/openapi/handler' },
    { from: '/docs/openapi/client/openapi-link', to: '/docs/openapi/link' },
    { from: '/docs/openapi/openapi-specification', to: '/docs/openapi/specification' },
    { from: '/docs/openapi/advanced/openapi-json-serializer', to: '/docs/openapi/serializer' },
    { from: '/docs/openapi/input-output-structure', to: '/docs/openapi/input-and-output-mapping' },
    { from: '/docs/openapi/advanced/redirect-response', to: '/docs/openapi/input-and-output-mapping#redirect-response' },
    { from: '/docs/openapi/advanced/expanding-type-support-for-openapi-link', to: '/docs/openapi/expanding-type-support-for-link' },

    { from: '/docs/event-iterator', to: '/docs/async-iterator-object' },
    { from: '/docs/client/event-iterator', to: '/docs/client/async-iterator-object' },
    { from: '/docs/file-upload-download', to: '/docs/binary-data' },

    { from: '/docs/plugins/batch-requests', to: '/docs/plugins/batch' },
    { from: '/docs/plugins/dedupe-requests', to: '/docs/plugins/dedupe' },
    { from: '/docs/plugins/client-retry', to: '/docs/plugins/retry' },
    { from: '/docs/plugins/rethrow-handler', to: '/docs/plugins/rethrow' },
    { from: '/docs/plugins/body-limit', to: '/docs/plugins/request-limit' },
    { from: '/docs/plugins/compression', to: '/docs/plugins/response-compression' },
    { from: '/docs/plugins/body-compression', to: '/docs/plugins/response-compression' },
    { from: '/docs/openapi/plugins/openapi-reference', to: '/docs/plugins/openapi-reference' },
    { from: '/docs/openapi/plugins/smart-coercion', to: '/docs/plugins/smart-coercion' },
    { from: '/docs/openapi/plugins/zod-smart-coercion', to: '/docs/plugins/smart-coercion' },
    { from: '/docs/plugins/hibernation', to: '/docs/integrations/hibernation' },
    { from: '/docs/plugins/request-headers', to: '/docs/headers' },
    { from: '/docs/plugins/response-headers', to: '/docs/headers' },

    { from: '/docs/integrations/react-swr', to: '/docs/integrations/swr' },
    { from: '/docs/openapi/integrations/implement-contract-in-nest', to: '/docs/integrations/nest' },
    { from: '/docs/openapi/integrations/trpc', to: '/docs/integrations/trpc' },
    { from: '/docs/server-action', to: '/docs/integrations/next' },
    { from: '/docs/integrations/tanstack-query-old/:slug*', to: '/docs/integrations/tanstack-query' },
  ],
  export: true,
  integrations: [
    {
      // Keeps `blume dev` within the default Node heap of an 8 GB machine; see
      // dev/server-sourcemaps.ts.
      name: 'server-sourcemaps',
      hooks: {
        'astro:config:setup': ({ updateConfig }) => {
          updateConfig({ vite: { plugins: [serverSourcemapsPlugin()] } })
        },
      },
    },
    {
      // Blume's PageLayout (used by the custom blog pages) imports the built-in
      // Header directly and has no layout-slot support, so the owned header in
      // components/blume/ is swapped in with a Vite alias that both RootLayout
      // and PageLayout resolve. It carries the "More" dropdown tab support.
      name: 'header-override',
      hooks: {
        'astro:config:setup': ({ updateConfig }) => {
          const headerPath = fileURLToPath(new URL('./components/blume/Header.astro', import.meta.url))
          updateConfig({
            vite: {
              resolve: {
                alias: [{ find: /^\.\/Header\.astro$/u, replacement: headerPath }],
              },
            },
          })
        },
      },
    },
    {
      // Anchors twoslash popups next to their token and keeps them inside
      // the viewport (theme.css fixes them so they escape the code scroller).
      name: 'twoslash-popups',
      hooks: {
        'astro:config:setup': ({ injectScript }) => {
          const clientPath = fileURLToPath(new URL('./components/blume/twoslash-popups.ts', import.meta.url))
          injectScript('page', `import '${clientPath.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`)
        },
      },
    },
    {
      // Blume drops fenced code from the search index; fold it back in so the
      // code-first docs are searchable by the API they demonstrate.
      name: 'search-code-index',
      hooks: {
        'astro:config:setup': ({ updateConfig, injectScript }) => {
          updateConfig({ vite: { plugins: [searchCodeIndexPlugin()] } })
          // Render the matched passage in the preview pane the way the page does.
          const clientPath = fileURLToPath(new URL('./search/page-preview.ts', import.meta.url))
          injectScript('page', `import '${clientPath.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`)
        },
      },
    },
    {
      name: 'sponsors',
      hooks: {
        'astro:config:setup': ({ injectScript, updateConfig }) => {
          // Inject <SponsorSlot /> into docs/blog MDX at build. The first one
          // is a static grid of every position; the client script fills the
          // later two-cell slots with a random pick per view.
          updateConfig({ vite: { plugins: [sponsorAdsInjectPlugin()] } })
          const clientPath = fileURLToPath(new URL('./sponsors/client.ts', import.meta.url))
          injectScript('page', `import '${clientPath.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`)
        },
      },
    },
  ],
  agents: {
    llmsTxt: {
      // The llms.txt "details" block, right after the title and summary: what
      // oRPC is, when to reach for it, and how to install it. No headings, the
      // spec reserves them for the page sections that follow.
      details: [
        'oRPC is an open-source (MIT) TypeScript library for end-to-end typesafe APIs. You write procedures, plain functions with optional input and output schemas (Zod, Valibot, ArkType, or any Standard Schema library), group them into a router, and serve it over HTTP. From that one router you get a fully typed client with no code generation, a REST API with a generated OpenAPI document, MCP tools for AI agents, and typed realtime streams.',
        '',
        'Reach for oRPC when:',
        '',
        '- A TypeScript frontend, mobile app, or service calls a TypeScript backend and both sides should share types without a build step.',
        '- You want tRPC-style RPC but also need a public REST API or an OpenAPI spec from the same code.',
        '- You want to design the API as a contract first, then implement it and call it from clients that only import the contract.',
        '- The API runs on Node.js, Bun, Deno, or Cloudflare Workers, inside a framework like Next.js, Nuxt, SvelteKit, or Hono, or feeds TanStack Query.',
        '',
        'Install the server and client with `npm install @orpc/server@beta @orpc/client@beta zod`, then follow [Getting Started](https://orpc.dev/docs/getting-started). These docs cover oRPC v2, currently in beta. The v1 docs live at https://v1.orpc.dev, and [Migrating from oRPC v1](https://orpc.dev/docs/migrations/from-v1) lists what changed.',
      ].join('\n'),
    },
    mcp: {
      enabled: true,
    },
    skills: '../../skills',
  },
  deployment: cloudflare({ site: 'https://orpc.dev' }),
})
