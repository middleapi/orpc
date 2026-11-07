import { defineConfig } from 'oxfmt'

export default defineConfig({
  semi: false,
  singleQuote: true,
  quoteProps: 'consistent',
  sortImports: true,
  ignorePatterns: ['.agents/skills/**', '.claude/skills/**'],
})
