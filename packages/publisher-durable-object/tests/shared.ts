import Database from 'better-sqlite3'
import { vi } from 'vitest'

export function createDurableObjectState(): any {
  const db = new Database(':memory:')
  const websockets: any[] = []

  return {
    storage: {
      sql: {
        exec: (query: string, ...bindings: any[]) => {
          const beforeTable = db.prepare(`
              SELECT count(name) as count FROM sqlite_master WHERE type='table'
          `).all()[0] as any

          const method = query.includes('SELECT') || query.includes('RETURNING') ? 'all' : 'run'
          const result = db.prepare(query)[method](...bindings)

          if (method === 'all') {
            return {
              one: () => (result as any)[0],
              toArray: () => result,
              rowsWritten: 0,
            }
          }

          const afterTable = db.prepare(`
              SELECT count(name) as count FROM sqlite_master WHERE type='table'
          `).all()[0] as any

          return {
            rowsWritten: (result as any).changes + (afterTable.count - beforeTable.count),
          }
        },
      },
      setAlarm: vi.fn(),
      deleteAll: vi.fn(async () => {
        const tables = db.prepare(`
          SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `).all() as { name: string }[]

        for (const table of tables) {
          db.prepare(`DROP TABLE IF EXISTS "${table.name}"`).run()
        }
      }),
    },
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn((ws: any) => {
      websockets.push(ws)
    }),
    getWebSockets: vi.fn(() => websockets),
    blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn()),
  }
}

export function createWebSocket(): any {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  }
}
