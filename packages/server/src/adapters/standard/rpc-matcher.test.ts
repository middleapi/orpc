import { oc } from '@orpc/contract'
import { z } from 'zod'
import { os } from '../../builder'
import { Lazy } from '../../lazy'
import * as ProcedureUtils from '../../procedure-utils'
import { withHiddenRouterContract } from '../../router-hidden'
import { RPCMatcher } from './rpc-matcher'

const createContractProcedureSpy = vi.spyOn(ProcedureUtils, 'createContractProcedure')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rpcMatcher', () => {
  const schema1 = z.object({ input: z.string() })
  const schema2 = z.object({ output: z.number() })

  const procedure1 = os.input(schema1).handler(() => 'output')
  const procedure2 = os.output(schema2).handler(() => ({ output: 456 }))
  const procedure3 = os.errors({ BAD_GATEWAY: {} }).handler(() => {})

  const lazyLazyLoader = vi.fn(async () => ({ default: { deep: procedure1 } }))
  const lazyLoader = vi.fn(async () => ({ default: {
    info: procedure3,
    lazy: new Lazy({
      loader: lazyLazyLoader,
      meta: {},
    }),
  } }))

  const router = {
    ping: procedure1,
    nested: {
      echo: procedure2,
    },
    lazy: new Lazy({
      loader: lazyLoader,
      meta: {},
    }),
  }

  it('matches a top-level procedure', async () => {
    const matcher = new RPCMatcher(router)
    const result = await matcher.match('POST', '/ping', undefined)

    expect(result).toBeDefined()
    expect(result!.path).toEqual(['ping'])
    expect(result!.procedure).toBe(procedure1)
    expect(lazyLoader).toHaveBeenCalledTimes(0)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(0)
  })

  it('matches a nested procedure', async () => {
    const matcher = new RPCMatcher(router)
    const result = await matcher.match('POST', '/nested/echo', undefined)

    expect(result).toBeDefined()
    expect(result!.path).toEqual(['nested', 'echo'])
    expect(result!.procedure).toBe(procedure2)
    expect(lazyLoader).toHaveBeenCalledTimes(0)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(0)
  })

  it('returns undefined for non-existent path', async () => {
    const matcher = new RPCMatcher(router)
    const result = await matcher.match('POST', '/nonexistent', undefined)

    expect(result).toBeUndefined()
    expect(lazyLoader).toHaveBeenCalledTimes(0)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(0)
  })

  it('resolves and matches a procedure in a lazy router', async () => {
    const matcher = new RPCMatcher(router)
    const result = await matcher.match('POST', '/lazy/info', undefined)

    expect(result).toBeDefined()
    expect(result!.path).toEqual(['lazy', 'info'])
    expect(result!.procedure).toBe(procedure3)
    expect(lazyLoader).toHaveBeenCalledTimes(1)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(0)

    const result3 = await matcher.match('POST', '/lazy/info', undefined)

    expect(result3).toEqual(result)
    // ensure the lazy loader is not called again
    expect(lazyLoader).toHaveBeenCalledTimes(1)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(0)
  })

  it('resolves and matches a deeply nested procedure in lazy routers', async () => {
    const matcher = new RPCMatcher(router)
    const result = await matcher.match('POST', '/lazy/lazy/deep', undefined)

    expect(result).toBeDefined()
    expect(result!.path).toEqual(['lazy', 'lazy', 'deep'])
    expect(result!.procedure).toBe(procedure1)
    expect(lazyLoader).toHaveBeenCalledTimes(1)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(1)

    const result2 = await matcher.match('POST', '/lazy/lazy/deep', undefined)
    expect(result2).toEqual(result)
    // ensure the lazy loaders are not called again
    expect(lazyLoader).toHaveBeenCalledTimes(1)
    expect(lazyLazyLoader).toHaveBeenCalledTimes(1)
  })

  it('support filter option', async () => {
    const filter = vi.fn((procedure: any) => procedure === procedure2)
    const matcher = new RPCMatcher(router, { filter })

    await expect(matcher.match('POST', '/ping', undefined)).resolves.toBeUndefined()
    await expect(matcher.match('POST', '/nested/echo', undefined)).resolves.toBeDefined()
  })

  describe('prefix', () => {
    it('handles prefix stripping', async () => {
      const matcher = new RPCMatcher(router)
      const result = await matcher.match('POST', '/api/v1/ping', '/api/v1')

      expect(result).toBeDefined()
      expect(result!.path).toEqual(['ping'])
      expect(result!.procedure).toBe(procedure1)
    })

    it('returns undefined when pathname does not start with prefix', async () => {
      const matcher = new RPCMatcher(router)
      const result = await matcher.match('POST', '/other/ping', '/api/v1')

      expect(result).toBeUndefined()
    })

    it('returns undefined when prefix is not a full path segment', async () => {
      const matcher = new RPCMatcher(router)
      const result = await matcher.match('POST', '/apiping', '/api')

      expect(result).toBeUndefined()
    })

    it('handles prefix stripping with trailing slash', async () => {
      const matcher = new RPCMatcher(router)
      const result = await matcher.match('POST', '/api/ping', '/api/')

      expect(result).toBeDefined()
      expect(result!.path).toEqual(['ping'])
      expect(result!.procedure).toBe(procedure1)
    })

    it('returns undefined when pathname is missing trailing slash while prefix has trailing slash', async () => {
      const matcher = new RPCMatcher(procedure1)
      const result = await matcher.match('POST', '/api', '/api/')

      expect(result).toBeUndefined()
    })

    it('handles prefix that is equal to pathname', async () => {
      const matcher = new RPCMatcher(procedure1)
      const result = await matcher.match('POST', '/api', '/api')

      expect(result).toBeDefined()
      expect(result!.path).toEqual([])
      expect(result!.procedure).toBe(procedure1)
    })
  })

  describe('contract first', () => {
    it('prefer hidden contract', async () => {
      const contract = {
        ping: oc.errors({ NOT_FOUND: {} }),
        nested: {
          echo: oc.input(z.object({ val: z.string() })),
        },
      }

      const matcher = new RPCMatcher(withHiddenRouterContract(router, contract))

      const r1 = await matcher.match('POST', '/ping', undefined)
      expect(r1).toBeDefined()
      expect(r1!.path).toEqual(['ping'])
      expect(createContractProcedureSpy).toHaveBeenCalledTimes(1)
      expect(createContractProcedureSpy).toHaveBeenNthCalledWith(1, router.ping, contract.ping)
      expect(r1!.procedure).not.toBe(procedure1)
      expect(r1!.procedure).toBe(createContractProcedureSpy.mock.results[0]!.value)

      const r2 = await matcher.match('POST', '/nested/echo', undefined)
      expect(r2).toBeDefined()
      expect(r2!.path).toEqual(['nested', 'echo'])
      expect(createContractProcedureSpy).toHaveBeenCalledTimes(2)
      expect(createContractProcedureSpy).toHaveBeenNthCalledWith(2, router.nested.echo, contract.nested.echo)
      expect(r2!.procedure).not.toBe(procedure2)
      expect(r2!.procedure).toBe(createContractProcedureSpy.mock.results[1]!.value)

      const r3 = await matcher.match('POST', '/lazy/info', undefined)
      expect(r3).toBeUndefined() // lazy is not in contract, so no match

      const r4 = await matcher.match('POST', '/api/ping', '/api')
      expect(r4).toBeDefined()
      expect(r4!.path).toEqual(['ping'])
      // no need to call createContractProcedure again for the same procedure
      expect(createContractProcedureSpy).toHaveBeenCalledTimes(2)
      expect(r4!.procedure).not.toBe(router.ping)
      expect(r4!.procedure).toBe(createContractProcedureSpy.mock.results[0]!.value)

      expect(lazyLazyLoader).toHaveBeenCalledTimes(0)
      expect(lazyLoader).toHaveBeenCalledTimes(0)
    })

    it('throws if missing implementation', async () => {
      const contract = {
        missing: oc.output(z.object({})),
      }

      const matcher = new RPCMatcher(withHiddenRouterContract(router, contract))
      await expect(matcher.match('POST', '/missing', undefined)).rejects.toThrowError('[Contract-First] Missing or invalid implementation for procedure at path: "missing"')
    })
  })

  describe('edge cases', () => {
    it('handles trailing slashes in pathname', async () => {
      const matcher = new RPCMatcher(router)
      const result = await matcher.match('POST', '/ping/', undefined)

      expect(result).toBeDefined()
      expect(result!.path).toEqual(['ping'])
      expect(result!.procedure).toBe(procedure1)
    })

    it('handles percent-encoded pathnames', async () => {
      const matcher = new RPCMatcher(router)
      const result = await matcher.match('POST', '/nested/%65cho', undefined) // %65 is 'e'

      expect(result).toBeDefined()
      expect(result!.path).toEqual(['nested', 'echo'])
      expect(result!.procedure).toBe(procedure2)
    })
  })
})
