import type { ClientContext, ClientLink } from '@orpc/client'
import { createContractCaller } from './caller'
import { ProcedureContract } from './procedure'

beforeEach(() => {
  vi.clearAllMocks()
})

function createContract(path?: string[]) {
  return new ProcedureContract({
    errorMap: {},
    meta: path ? { '~path': path } : {},
    inputSchemas: [],
    outputSchemas: [],
  })
}

describe('createContractCaller', () => {
  const mockedLink: ClientLink<ClientContext> = {
    call: vi.fn().mockReturnValue('__mocked__'),
  }

  it('throws when procedure contract has no meta.path', async () => {
    const caller = createContractCaller(mockedLink)
    const procedure = createContract()

    await expect(caller(procedure as any, { value: 'hello' })).rejects.toThrow(
      'ContractCaller: procedure contract must define `meta.path` that matches its path in the root router contract.',
    )

    expect(mockedLink.call).not.toHaveBeenCalled()
  })

  it('calls the link with the procedure path and syncs routerRef', async () => {
    const routerRef = {}
    const caller = createContractCaller(mockedLink, { contractRef: routerRef })
    const procedure = createContract(['users', 'list'])
    const signal = new AbortController().signal

    expect(await caller(procedure as any, { value: 'hello' }, { context: { requestId: 'request_1' }, signal })).toBe('__mocked__')

    expect(routerRef).toEqual({
      users: {
        list: {
          '~orpc': procedure['~orpc'],
        },
      },
    })
    expect((routerRef as any).users.list).toBeInstanceOf(ProcedureContract)

    expect(mockedLink.call).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledWith(
      ['users', 'list'],
      { value: 'hello' },
      { context: { requestId: 'request_1' }, signal },
    )
  })

  it('passes interceptors through to the per-procedure client', async () => {
    const interceptor = vi.fn(({ path, input, context, next }) => {
      expect(path).toEqual(['users', 'find'])
      expect(input).toEqual({ value: 'hello' })
      expect(context).toEqual({ requestId: 'request_1' })

      return next({
        path,
        input: { value: 'intercepted' },
        context: { ...context, traceId: 'trace_1' },
      })
    })

    const caller = createContractCaller(mockedLink, {
      interceptors: [interceptor],
    })

    expect(await caller(createContract(['users', 'find']) as any, { value: 'hello' }, { context: { requestId: 'request_1' } })).toBe('__mocked__')

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledWith(
      ['users', 'find'],
      { value: 'intercepted' },
      { context: { requestId: 'request_1', traceId: 'trace_1' } },
    )
  })

  it('throw when scoped option is invalid at given path', async () => {
    const caller = createContractCaller(mockedLink, {
      scoped: {
        users: {
          find: '' as any,
          list: undefined,
          create: {
            interceptors: [],
          },
        },
      },
    })

    await expect(caller(createContract(['users', 'find']))).rejects.toThrow(
      'ContractCaller: "scoped" at path "users.find" must be an object or undefined, got "".',
    )

    await expect(caller(createContract(['users', 'list']))).resolves.toEqual('__mocked__')
  })

  it('passes scoped through to the per-procedure client', async () => {
    const interceptor = vi.fn(({ path, input, context, next }) => {
      expect(path).toEqual(['users', 'find'])
      expect(input).toEqual({ value: 'hello' })
      expect(context).toEqual({ requestId: 'request_1' })

      return next({
        path,
        input: { value: 'intercepted' },
        context: { ...context, traceId: 'trace_1' },
      })
    })

    const caller = createContractCaller(mockedLink, {
      scoped: {
        users: {
          find: {
            interceptors: [interceptor],
          },
        },
      },
    })

    expect(await caller(createContract(['users', 'find']) as any, { value: 'hello' }, { context: { requestId: 'request_1' } })).toBe('__mocked__')

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledWith(
      ['users', 'find'],
      { value: 'intercepted' },
      { context: { requestId: 'request_1', traceId: 'trace_1' } },
    )
  })
})
