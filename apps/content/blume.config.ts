import { fileURLToPath } from 'node:url'
import { defineConfig } from 'blume'
import { searchCodeIndexPlugin } from './search/code-index'
import { sponsorAdsInjectPlugin } from './sponsors/inject'

export default defineConfig({
  title: 'oRPC',
  description: 'Easy to build APIs that are end-to-end type-safe and adhere to OpenAPI standards',
  logo: '/logo.svg',
  content: {
    sources: [
      {
        type: 'filesystem',
        root: '.',
        include: [
          'index.mdx',
          'docs/**/*.{md,mdx}',
          'blog/**/*.{md,mdx}',
        ],
      },
      {
        type: 'github-releases',
        prefix: 'changelog',
        owner: 'middleapi',
        repo: 'orpc',
        prereleases: true,
      },
    ],
  },
  github: {
    owner: 'middleapi',
    repo: 'orpc',
    dir: 'apps/content',
  },
  theme: {
    // Monochrome accent to match the oRPC brand: black in light, white in dark.
    accent: { light: 'oklch(0.145 0 0)', dark: 'oklch(0.985 0 0)' },
    // Zed One Dark editor background; the rest of the palette lives in theme.css.
    background: { dark: '#282c33' },
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
      { label: 'Changelog', path: '/changelog', href: '/changelog' },
      { label: 'Comparison', path: '/docs', href: '/docs/comparison' },
      {
        label: 'More',
        path: '',
        items: [
          { label: 'V1 Documentation', path: 'https://v1.orpc.dev' },
          { label: 'Discussions', path: 'https://github.com/middleapi/orpc/discussions' },
          { label: 'Sponsors', path: 'https://github.com/sponsors/dinwwwh' },
          { label: 'LLM Context', path: 'https://orpc.dev/llms.txt' },
          { label: 'LLM Context (Full)', path: 'https://orpc.dev/llms-full.txt' },
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
          // Inject <SponsorSlot /> into docs/blog MDX at build; fill the
          // slots with a random sponsor per view via the client script.
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
  },
  deployment: {
    output: 'server',
    adapter: 'vercel',
    site: 'https://orpc.dev',
  },
})
