import { oc } from '@orpc/contract'
import { ContractOptionsUtilsPlugin, getPiniaColadaMeta, piniaColada } from './meta'
import { createRouterUtils } from './router-utils'

describe('piniaColada', () => {
  it('stores options readable via getPiniaColadaMeta', () => {
    const interceptor = vi.fn()
    const contract = oc.meta(piniaColada({
      queryOptions: { staleTime: 1000 },
      queryInterceptors: [interceptor],
    }))

    expect(getPiniaColadaMeta(contract)).toEqual({
      queryOptions: { staleTime: 1000 },
      queryInterceptors: [interceptor],
    })

    expect(getPiniaColadaMeta(oc)).toBeUndefined()
  })

  it('merges options when applied multiple times', () => {
    const interceptor1 = vi.fn()
    const interceptor2 = vi.fn()
    const keyModifier = vi.fn()

    const contract = oc
      .meta(piniaColada({
        queryKey: keyModifier,
        queryOptions: { staleTime: 1000, gcTime: 1 },
        queryInterceptors: [interceptor1],
      }))
      .meta(piniaColada({
        queryOptions: { gcTime: 2 },
        mutationInterceptors: [interceptor2],
      }))

    expect(getPiniaColadaMeta(contract)).toEqual({
      queryKey: keyModifier,
      queryOptions: { staleTime: 1000, gcTime: 2 },
      queryInterceptors: [interceptor1],
      streamedInterceptors: [],
      liveInterceptors: [],
      infiniteInterceptors: [],
      mutationInterceptors: [interceptor2],
    })
  })

  it('composes function modifiers, base applied first', () => {
    const contract = oc
      .meta(piniaColada({
        queryOptions: options => ({ ...options, staleTime: 1000, gcTime: 1 }),
      }))
      .meta(piniaColada({
        queryOptions: options => ({ ...options, gcTime: 2 }),
      }))

    const merged: any = getPiniaColadaMeta(contract)?.queryOptions

    expect(merged({ enabled: true })).toEqual({ enabled: true, staleTime: 1000, gcTime: 2 })
  })

  it('composes mixed object and function modifiers', () => {
    const objectFirst = oc
      .meta(piniaColada({ queryOptions: { staleTime: 1000, gcTime: 1 } }))
      .meta(piniaColada({ queryOptions: options => ({ ...options, gcTime: 2 }) }))

    const objectFirstMerged: any = getPiniaColadaMeta(objectFirst)?.queryOptions

    expect(objectFirstMerged({ enabled: true })).toEqual({ enabled: true, staleTime: 1000, gcTime: 2 })

    const functionFirst = oc
      .meta(piniaColada({ queryOptions: options => ({ ...options, staleTime: 1000 }) }))
      .meta(piniaColada({ queryOptions: { gcTime: 2 } }))

    const functionFirstMerged: any = getPiniaColadaMeta(functionFirst)?.queryOptions

    expect(functionFirstMerged({ enabled: true })).toEqual({ enabled: true, staleTime: 1000, gcTime: 2 })
  })

  it('propagates base meta to procedures via .router', () => {
    const router = oc
      .meta(piniaColada({ queryOptions: { staleTime: 1000 } }))
      .router({
        ping: oc.meta(piniaColada({ queryOptions: { gcTime: 2 } })),
        pong: oc,
      })

    expect(getPiniaColadaMeta(router.ping)).toEqual({
      queryOptions: { staleTime: 1000, gcTime: 2 },
      queryInterceptors: [],
      streamedInterceptors: [],
      liveInterceptors: [],
      infiniteInterceptors: [],
      mutationInterceptors: [],
    })

    expect(getPiniaColadaMeta(router.pong)).toEqual({
      queryOptions: { staleTime: 1000 },
    })
  })
})

describe('contractOptionsUtilsPlugin', () => {
  it('leaves options unchanged when no procedure or no meta at path', () => {
    const plugin = new ContractOptionsUtilsPlugin({ planet: { find: oc } })
    const options = { prefix: '__prefix__' }

    expect(plugin.initProcedureOptions(['unknown'], options)).toBe(options)
    expect(plugin.initProcedureOptions(['planet'], options)).toBe(options)
    expect(plugin.initProcedureOptions(['planet', 'find'], options)).toBe(options)
  })

  it('merges meta options as base under current options', () => {
    const metaInterceptor = vi.fn()
    const existingInterceptor = vi.fn()

    const plugin = new ContractOptionsUtilsPlugin({
      planet: {
        find: oc.meta(piniaColada({
          queryOptions: { staleTime: 1000, gcTime: 1 },
          queryInterceptors: [metaInterceptor],
        })),
      },
    })

    const result = plugin.initProcedureOptions(['planet', 'find'], {
      prefix: '__prefix__',
      queryOptions: { gcTime: 2 },
      queryInterceptors: [existingInterceptor],
    } as any)

    expect(result).toEqual({
      prefix: '__prefix__',
      queryOptions: { staleTime: 1000, gcTime: 2 },
      queryInterceptors: [metaInterceptor, existingInterceptor],
      streamedInterceptors: [],
      liveInterceptors: [],
      infiniteInterceptors: [],
      mutationInterceptors: [],
    })
  })

  it('applies contract meta through createRouterUtils', async () => {
    const marks: string[] = []
    const metaInterceptor = vi.fn(({ next }: any) => {
      marks.push('meta')
      return next()
    })
    const utilsInterceptor = vi.fn(({ next }: any) => {
      marks.push('utils')
      return next()
    })

    const contract = {
      planet: {
        find: oc.meta(piniaColada({
          queryOptions: { staleTime: 1000, gcTime: 1 },
          queryInterceptors: [metaInterceptor],
        })),
      },
    }

    const client = {
      planet: {
        find: vi.fn(async () => '__found__'),
      },
    }

    const utils = createRouterUtils(client as any, {
      queryInterceptors: [utilsInterceptor],
      scoped: {
        planet: {
          find: {
            queryOptions: { gcTime: 2 },
          },
        },
      },
      plugins: [new ContractOptionsUtilsPlugin(contract)],
    }) as any

    const options = utils.planet.find.queryOptions({ input: { id: 1 } })

    expect(options.staleTime).toBe(1000)
    expect(options.gcTime).toBe(2)

    await expect(options.query({ signal: undefined })).resolves.toBe('__found__')

    expect(marks).toEqual(['meta', 'utils'])
    expect(client.planet.find).toHaveBeenCalledTimes(1)
  })
})
