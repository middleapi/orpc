import { defineConfig } from 'oxfmt'

export default defineConfig({
  semi: false,
  singleQuote: true,
  quoteProps: 'consistent',
  sortImports: true,
  // Blume's MDX (directives, expressions) is not safe to reformat; `.agents` holds vendored skills
  ignorePatterns: ['**/*.mdx', '.agents/**', '.claude/skills/**'],
})
