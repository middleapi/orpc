import { defineConfig } from 'oxfmt'

export default defineConfig({
  semi: false,
  singleQuote: true,
  quoteProps: 'consistent',
  sortImports: true,
  ignorePatterns: [
    '.agents/**',
    '.claude/**',
    '**/worker-configuration.d.ts',
    'apps/content/sponsors/slots.ts',
    'apps/content/sponsors/sponsors.ts',
  ],
})
