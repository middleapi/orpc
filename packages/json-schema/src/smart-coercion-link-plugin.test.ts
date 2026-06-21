import type { AnyORPCError } from '@orpc/client'
import { ORPCError } from '@orpc/client'
import { oc } from '@orpc/contract'
import z from 'zod'
import { SmartCoercionLinkPlugin } from './smart-coercion-link-plugin'

describe('smartCoercionLinkPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('appends its interceptor and throws when the resolved contract is not a procedure', async () => {
    const contract = oc.router({
      users: {
        list: oc,
      },
    })
    const existingInterceptor = vi.fn()
    const plugin = new SmartCoercionLinkPlugin(contract)

    const options = plugin.init({ interceptors: [existingInterceptor] } as any)

    expect(options.interceptors).toHaveLength(2)
    expect(options.interceptors?.[0]).toBe(existingInterceptor)

    await expect(options.interceptors?.[1]?.({
      path: ['users', 'list', 'extra'],
      next: vi.fn(),
    } as any)).rejects.toThrow(
      'No valid procedure found at path "users.list.extra"',
    )
  })

  it('returns the original output when the procedure has no output schemas', async () => {
    const contract = oc.router({
      users: {
        get: oc,
      },
    })

    const plugin = new SmartCoercionLinkPlugin(contract)

    const output = { value: '1' }
    const next = vi.fn().mockResolvedValue(output)
    const interceptor = plugin.init({} as any).interceptors?.[0]

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).resolves.toBe(output)

    expect(next).toHaveBeenCalledOnce()
  })

  it('coerces output schemas and reuses converted schemas from the cache', async () => {
    const contract = oc.router({
      users: {
        get: oc.output(z.looseObject({ number: z.number() })).output(z.looseObject({ boolean: z.boolean() })),
      },
    })

    const plugin = new SmartCoercionLinkPlugin(contract)

    const interceptor = plugin.init({} as any).interceptors?.[0]
    const next = vi.fn()
      .mockResolvedValueOnce({ number: '123', boolean: 'true' })
      .mockResolvedValueOnce({ number: '456', boolean: 'off' })

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).resolves.toEqual({ number: 123, boolean: true })

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).resolves.toEqual({ number: 456, boolean: false })
  })

  it('throw the original error when it not defined ORPCError or has no data schema', async () => {
    const contract = oc.router({
      users: {
        get: oc,
      },
    })

    const plugin = new SmartCoercionLinkPlugin(contract)

    const error = new Error('Message')
    const orpcError = new ORPCError('FORBIDDEN')
    const definedORPCError = new ORPCError('FORBIDDEN')
    ;(definedORPCError as any).defined = true

    const interceptor = plugin.init({} as any).interceptors?.[0]
    const next = vi.fn()
      .mockThrowOnce(error)
      .mockThrowOnce(orpcError)
      .mockThrowOnce(definedORPCError)

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).rejects.toBe(error)

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).rejects.toBe(orpcError)

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).rejects.toBe(definedORPCError)
  })

  it('coerces error data', async () => {
    const contract = oc.router({
      users: {
        get: oc.errors({
          FORBIDDEN: {
            data: z.object({ number: z.number() }),
          },
        }),
      },
    })

    const plugin = new SmartCoercionLinkPlugin(contract)

    const definedORPCError = new ORPCError('FORBIDDEN', { data: { number: '123' } })
    ;(definedORPCError as any).defined = true

    const interceptor = plugin.init({} as any).interceptors?.[0]
    const next = vi.fn().mockThrowOnce(definedORPCError)

    await expect(interceptor?.({
      path: ['users', 'get'],
      next,
    } as any)).rejects.toSatisfy((error: AnyORPCError) => {
      expect(error).instanceOf(ORPCError)
      expect(error).not.toBe(definedORPCError)
      expect(error.defined).toEqual(true)
      expect(error.stack).toEqual(definedORPCError.stack)
      expect(error.data).toEqual({ number: 123 })

      return true
    })
  })
})
