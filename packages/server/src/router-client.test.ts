import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { lazy, unlazy } from './lazy'
import { Procedure } from './procedure'
import { createProcedureClient } from './procedure-client'
import { createRouterClient } from './router-client'

vi.mock('./procedure-client', () => ({
  createProcedureClient: vi.fn(() => vi.fn(() => '__mocked__')),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRouterClient', () => {
  const schema = z.object({ val: z.string().transform(v => Number(v)) })
  const ping = new Procedure({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    handler: vi.fn(() => ({ val: '123' })),
  })
  const pong = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: vi.fn(() => ('output')),
  })

  const router = {
    ping: lazy(() => Promise.resolve({ default: ping })),
    pong,
    nested: lazy(() => Promise.resolve({ default: {
      ping,
      pong: lazy(() => Promise.resolve({ default: pong })),
    } })),
  }

  const client = createRouterClient({
    router,
    context: { auth: true },
    path: ['users'],
  })

  it('works', () => {
    expect(client.pong({ val: '123' })).toEqual('__mocked__')

    expect(createProcedureClient).toBeCalledTimes(1)
    expect(createProcedureClient).toBeCalledWith(expect.objectContaining({
      procedure: pong,
      context: { auth: true },
      path: ['users', 'pong'],
    }))

    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledTimes(1)
    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledWith({ val: '123' })
  })

  it('work with lazy', async () => {
    expect(client.ping({ val: '123' })).toEqual('__mocked__')

    expect(createProcedureClient).toBeCalledTimes(1)
    expect(createProcedureClient).toHaveBeenNthCalledWith(1, expect.objectContaining({
      procedure: expect.any(Object),
      context: { auth: true },
      path: ['users', 'ping'],
    }))

    expect((await unlazy(vi.mocked(createProcedureClient as any).mock.calls[0]![0].procedure)).default).toBe(ping)

    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledTimes(1)
    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledWith({ val: '123' })
  })

  it('work with nested lazy', async () => {
    expect(client.nested.ping({ val: '123' })).toEqual('__mocked__')

    expect(createProcedureClient).toBeCalledTimes(2)
    expect(createProcedureClient).toHaveBeenNthCalledWith(2, expect.objectContaining({
      procedure: expect.any(Object),
      context: { auth: true },
      path: ['users', 'nested', 'ping'],
    }))

    const lazied = vi.mocked(createProcedureClient as any).mock.calls[1]![0].procedure
    expect(await unlazy(lazied)).toEqual({ default: ping })

    expect(vi.mocked(createProcedureClient).mock.results[1]?.value).toBeCalledTimes(1)
    expect(vi.mocked(createProcedureClient).mock.results[1]?.value).toBeCalledWith({ val: '123' })
  })

  it('work with procedure as router', () => {
    const client = createRouterClient({
      router: ping,
      context: { auth: true },
      path: ['users'],
    })

    expect(client({ val: '123' })).toEqual('__mocked__')

    expect(createProcedureClient).toBeCalledTimes(1)
    expect(createProcedureClient).toHaveBeenCalledWith(expect.objectContaining({
      procedure: ping,
      context: { auth: true },
      path: ['users'],
    }))

    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledTimes(1)
    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledWith({ val: '123' })
  })

  it('hooks', async () => {
    const onStart = vi.fn()
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const onFinish = vi.fn()
    const execute = vi.fn()

    const client = createRouterClient({
      router,
      context: { auth: true },
      onStart,
      onSuccess,
      onError,
      onFinish,
      execute,
    })

    expect(client.pong({ val: '123' })).toEqual('__mocked__')

    expect(createProcedureClient).toBeCalledTimes(1)
    expect(createProcedureClient).toHaveBeenCalledWith(expect.objectContaining({
      procedure: pong,
      context: { auth: true },
      path: ['pong'],
      onStart,
      onSuccess,
      onError,
      onFinish,
      execute,
    }))
  })

  it('not recursive on symbol', () => {
    expect((client as any)[Symbol('something')]).toBeUndefined()
  })

  it('return undefined if access the undefined key', async () => {
    const client = createRouterClient({
      router: {
        ping,
      },
    })

    // @ts-expect-error --- invalid access
    expect(client.router).toBeUndefined()
  })

  it('works without base path', async () => {
    const client = createRouterClient({
      router: {
        ping,
      },
    })

    expect(client.ping({ val: '123' })).toEqual('__mocked__')
    expect(vi.mocked(createProcedureClient).mock.calls[0]![0].path).toEqual(['ping'])
  })
})
