import Database from 'better-sqlite3'

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
      deleteAll: vi.fn(),
    },
    waitUntil: vi.fn(),
    acceptWebSocket: vi.fn((ws: any) => {
      websockets.push(ws)
    }),
    getWebSockets: vi.fn(() => websockets),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  }
}

export function createWebSocket(): any {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  }
}
