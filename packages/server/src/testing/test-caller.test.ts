import * as z from 'zod'
import { os } from '../builder'
import { configureTestCaller, createTestCaller } from './test-caller'

interface PingContext {
  db?: string
  globalDb?: string
}

interface TenantContext {
  tenantId: string
  db: string
}

describe('createTestCaller', () => {
  const pingBase = os.$context<PingContext>()
  const pingProcedure = pingBase
    .input(z.object({ name: z.string() }))
    .handler(async ({ input, context }) => ({
      message: `Hello ${input.name}`,
      context,
    }))

  const tenantBase = os.$context<TenantContext>()
  const tenantProcedure = tenantBase
    .input(z.object({ theme: z.string() }))
    .handler(async ({ input, context }) => ({
      activeTenantId: context.tenantId,
      theme: input.theme,
      db: context.db,
    }))

  it('supports static context mode', async () => {
    const caller = createTestCaller(pingProcedure, {
      context: { db: 'mock-db' },
    })

    const result = await caller({ name: 'World' })
    expect(result.message).toBe('Hello World')
    expect(result.context).toEqual({ db: 'mock-db' })
  })

  it('supports dynamic context factory function', async () => {
    let callCounter = 0
    const caller = createTestCaller(tenantProcedure, {
      context: () => {
        callCounter++
        return {
          tenantId: `tenant-${callCounter}`,
          db: `db-${callCounter}`,
        }
      },
    })

    const res1 = await caller({ theme: 'dark' })
    expect(res1.activeTenantId).toBe('tenant-1')
    expect(res1.db).toBe('db-1')

    const res2 = await caller({ theme: 'light' })
    expect(res2.activeTenantId).toBe('tenant-2')
    expect(res2.db).toBe('db-2')
  })

  it('supports per-call context overrides', async () => {
    const caller = createTestCaller(pingProcedure, {
      context: { db: 'default-db' },
    })

    const res1 = await caller({ name: 'Default' })
    expect(res1.context).toEqual({ db: 'default-db' })

    const res2 = await caller(
      { name: 'Overridden' },
      { context: { db: 'custom-db' } },
    )
    expect(res2.context).toEqual({ db: 'custom-db' })
  })

  it('supports suite-wide global test context', async () => {
    configureTestCaller({
      context: () => ({
        globalDb: 'postgres-test',
      }),
    })

    const caller = createTestCaller(pingProcedure)
    const result = await caller({ name: 'Suite' })

    expect(result.context.globalDb).toBe('postgres-test')
  })

  it('supports partial context overrides', async () => {
    const caller = createTestCaller(tenantProcedure, {
      context: { tenantId: 'tenant-partial' },
    })

    const res = await caller(
      { theme: 'dark' },
      { context: { db: 'db-partial' } },
    )

    expect(res.activeTenantId).toBe('tenant-partial')
    expect(res.db).toBe('db-partial')
  })
})
