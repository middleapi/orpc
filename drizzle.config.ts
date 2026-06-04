import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: ['./server/db/schema.ts', './server/db/schema/*.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['shared', 'lunaria', 'market_trends'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/base',
  },
})
