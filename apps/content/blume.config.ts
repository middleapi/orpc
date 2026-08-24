import { fileURLToPath } from 'node:url'
import { defineConfig } from 'blume'
import { searchCodeIndexPlugin } from './search/code-index'
import { sponsorAdsInjectPlugin } from './sponsors/inject'

export default defineConfig({
  title: 'oRPC',
  description: 'Build APIs that are typesafe end to end, with OpenAPI included',
  logo: '/logo.svg',
  content: {
    sources: [
      {
        type: 'filesystem',
        root: '.',
        include: [
          'docs/**/*.{md,mdx}',
          'blog/**/*.{md,mdx}',
        ],
      },
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
  lastModified: true,
  navigation: {
    sidebar: {
      display: 'group',
    },
    tabs: [
      { label: 'Documentation', path: '/docs' },
      { label: 'Blog', path: '/blog', href: '/blog' },
      { label: 'Comparison', path: '/docs', href: '/docs/comparison' },
      { label: 'From V1', path: '/docs', href: '/docs/migrations/from-v1' },
      {
        label: 'More',
        path: '',
        items: [
          { label: 'Releases', path: 'https://github.com/middleapi/orpc/releases' },
          { label: 'Discussions', path: 'https://github.com/middleapi/orpc/discussions' },
          { label: 'GitHub Sponsors', path: 'https://github.com/sponsors/dinwwwh' },
          { label: 'Open Collective', path: 'https://opencollective.com/middleapi' },
          { label: 'LLM Context', path: 'https://orpc.dev/llms.txt' },
          { label: 'LLM Context (Full)', path: 'https://orpc.dev/llms-full.txt' },
          { label: 'V1 Documentation', path: 'https://v1.orpc.dev' },
        ],
      },
    ],
  },
  analytics: {
    posthog: {
      key: 'phc_YHeqjC9tR604AHH45kQi63fT4aBvpsS7zAaCxntBzZm',
    },
  },

  seo: {
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
    { from: '/docs/plugins/hibernation', to: '/docs/integrations/hibernation' },

    { from: '/docs/integrations/react-swr', to: '/docs/integrations/swr' },
    { from: '/docs/openapi/integrations/implement-contract-in-nest', to: '/docs/integrations/nest' },
    { from: '/docs/openapi/integrations/trpc', to: '/docs/integrations/trpc' },
    { from: '/docs/server-action', to: '/docs/integrations/next' },
  ],
  export: true,
  integrations: [
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
      // Keeps mobile twoslash popups inside the viewport (theme.css anchors
      // them below the hovered token; this nudges bottom-of-screen ones up).
      name: 'twoslash-mobile',
      hooks: {
        'astro:config:setup': ({ injectScript }) => {
          const clientPath = fileURLToPath(new URL('./components/blume/twoslash-mobile.ts', import.meta.url))
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
  ai: {
    mcp: {
      enabled: true,
    },
    skills: '../../skills',
  },
  deployment: {
    output: 'server',
    adapter: 'cloudflare',
    site: 'https://orpc.dev',
  },
})
