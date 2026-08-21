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
    // Zed One Dark editor background; the rest of the palette lives in theme.css.
    background: { dark: '#0d1016' },
    fonts: {
      display: 'inter',
      body: 'inter',
    },
  },
  lastModified: true,
  navigation: {
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
    adapter: 'vercel',
    site: 'https://orpc.dev',
  },
})
