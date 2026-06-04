import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/base'

const globalForDatabase = globalThis as typeof globalThis & {
  __basePostgresClient?: postgres.Sql
}

const databaseClient = globalForDatabase.__basePostgresClient ?? postgres(databaseUrl, {
  max: 10,
})

globalForDatabase.__basePostgresClient = databaseClient

export const db = drizzle(databaseClient, { schema })

export async function closeDatabaseConnection() {
  await databaseClient.end()
}
