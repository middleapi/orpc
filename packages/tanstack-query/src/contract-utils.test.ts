import { ProcedureContract } from '@orpc/contract'
import { createContractJsonifiedUtilsFactory, createContractUtilsFactory } from './contract-utils'
import * as routerUtilsModule from './router-utils'

const createRouterUtilsSpy = vi.spyOn(routerUtilsModule, 'createRouterUtils')

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

describe('createContractUtilsFactory', () => {
  const caller = vi.fn()

  it('throws when procedure contract has no meta.path', () => {
    const factory = createContractUtilsFactory(caller as any, {})
    const procedure = createContract()

    expect(() => factory(procedure as any)).toThrow(
      'ContractUtilsFactory: procedure contract must define `meta.path` that matches its path in the root router contract.',
    )

    expect(createRouterUtilsSpy).not.toHaveBeenCalled()
  })

  it('throws when scoped option is invalid at given path', () => {
    const factory = createContractUtilsFactory(caller as any, {
      scoped: {
        users: {
          list: 'invalid' as any,
        },
      },
    })

    expect(() => factory(createContract(['users', 'list']) as any)).toThrow(
      'ContractUtilsFactory: "scoped" at path "users.list" must be an object or undefined, got "invalid".',
    )

    expect(createRouterUtilsSpy).not.toHaveBeenCalled()
  })

  it('scopes options and wraps caller for createRouterUtils', () => {
    const delegatedUtils = { queryOptions: vi.fn() }
    const queryInterceptor = vi.fn()
    const mutationInterceptor = vi.fn()
    const plugin = {
      name: 'test-plugin',
      init: vi.fn((options: unknown) => options),
      initProcedureOptions: vi.fn((_: string[], options: unknown) => options),
    }
    const scopedOptions = {
      queryOptions: {
        staleTime: 1000,
      },
    }
    const options = {
      prefix: '__prefix__',
      path: ['__base__'],
      queryInterceptors: [queryInterceptor],
      mutationInterceptors: [mutationInterceptor],
      plugins: [plugin],
      scoped: {
        users: {
          list: scopedOptions,
        },
      },
    }
    const procedure = createContract(['users', 'list'])

    caller.mockReturnValueOnce('__mocked__')
    createRouterUtilsSpy.mockReturnValueOnce(delegatedUtils as any)

    const factory = createContractUtilsFactory(caller as any, options as any)
    const result = factory(procedure as any)

    expect(result).toBe(delegatedUtils)
    expect(createRouterUtilsSpy).toHaveBeenCalledTimes(1)

    const [client, createRouterUtilsOptions] = createRouterUtilsSpy.mock.calls[0]!

    expect(createRouterUtilsOptions).toEqual({
      ...options,
      path: ['__base__', 'users', 'list'],
      scoped: scopedOptions,
    })

    expect((client as any)({ value: 'hello' }, { context: { requestId: 'request_1' } })).toBe('__mocked__')
    expect(caller).toHaveBeenCalledTimes(1)
    expect(caller).toHaveBeenCalledWith(
      procedure,
      { value: 'hello' },
      { context: { requestId: 'request_1' } },
    )
  })
})

describe('createContractJsonifiedUtilsFactory', () => {
  const caller = vi.fn()

  it('delegates to createRouterUtils with the scoped path and scoped', () => {
    const delegatedUtils = { mutationOptions: vi.fn() }
    const scopedOptions = {
      mutationOptions: {
        meta: {
          feature: 'jsonified',
        },
      },
    }
    const procedure = createContract(['nested', 'pong'])

    caller.mockReturnValueOnce('__jsonified__')
    createRouterUtilsSpy.mockReturnValueOnce(delegatedUtils as any)

    const factory = createContractJsonifiedUtilsFactory(caller as any, {
      prefix: '__json__',
      scoped: {
        nested: {
          pong: scopedOptions,
        },
      },
    } as any)
    const result = factory(procedure as any)

    expect(result).toBe(delegatedUtils)
    expect(createRouterUtilsSpy).toHaveBeenCalledTimes(1)

    const [client, createRouterUtilsOptions] = createRouterUtilsSpy.mock.calls[0]!

    expect(createRouterUtilsOptions).toEqual({
      prefix: '__json__',
      scoped: scopedOptions,
      path: ['nested', 'pong'],
    })

    expect((client as any)('payload')).toBe('__jsonified__')
    expect(caller).toHaveBeenCalledTimes(1)
    expect(caller).toHaveBeenCalledWith(procedure, 'payload')
  })
})
