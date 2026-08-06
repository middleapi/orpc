import { fileURLToPath } from 'node:url'
import { defineConfig } from 'blume'
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
          'learn-and-contribute/**/*.{md,mdx}',
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
  lastModified: true,
  navigation: {
    sidebar: {
      display: 'group',
    },
    tabs: [
      { label: 'Docs', path: '/docs' },
      { label: 'Blog', path: '/blog', href: '/blog' },
      { label: 'Learn & Contribute', path: '/learn-and-contribute' },
      { label: 'Changelog', path: '/changelog', href: '/changelog' },
    ],
    selectors: [
      {
        kind: 'version',
        label: 'Version',
        items: [
          { label: 'v2 (latest)', path: '/', icon: 'rocket' },
          { label: 'v1', path: 'https://v1.orpc.dev' },
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
