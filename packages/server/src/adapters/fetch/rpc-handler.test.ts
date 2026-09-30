import type { AnyProcedureContract } from '@orpc/contract'
import type { Lazyable } from '../../lazy'
import type { AnyRouter } from '../../router'
import type { StandardHandlerPlugin } from '../standard'
import { oc, type } from '@orpc/contract'
import { os } from '../../builder'
import { implement } from '../../implementer'
import { unlazy } from '../../lazy'
import { getHiddenRouterContract } from '../../router-hidden'
import { RPCHandler } from './rpc-handler'

describe('rpcHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts context and prefix options in handle method', async () => {
    const contextHandler = new RPCHandler({
      ping: os
        .$context<{ userId: string }>()
        .handler(({ context }) => context.userId),
    })

    const { matched, response } = await contextHandler.handle(
      new Request('https://example.com/api/v1/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: null }),
      }),
      {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      },
    )

    expect(matched).toBe(true)
    expect(response!.status).toBe(200)
    await expect(response!.text()).resolves.toContain('u_123')

    const misMatchPrefixResult = await contextHandler.handle(
      new Request('https://example.com/invalid/ping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: null }),
      }),
      {
        context: { userId: 'u_123' },
        prefix: '/api/v1',
      },
    )

    expect(misMatchPrefixResult.matched).toBe(false)
    expect(misMatchPrefixResult.response).toBeUndefined()
  })

  it('supports standard handler plugins', async () => {
    const plugin: StandardHandlerPlugin<any> = {
      name: 'test',
      init(options) {
        return {
          ...options,
          routingInterceptors: [
            async () => ({ matched: true, response: { status: 200, headers: {}, body: 'intercepted' } }),
          ],
        }
      },
    }

    const handler = new RPCHandler({}, { plugins: [plugin] })

    const { matched, response } = await handler.handle(new Request('https://example.com/test'))

    expect(matched).toBe(true)
    expect(response).toBeInstanceOf(Response)
    expect(response!.status).toBe(200)
    return expect(response!.text()).resolves.toBe('"intercepted"')
  })

  it('treats GET requests as unmatched by default', async () => {
    const handler = new RPCHandler({
      ping: os.handler(() => 'pong'),
    })

    const result = await handler.handle(
      new Request(`https://example.com/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(result.matched).toBe(false)
    expect(result.response).toBeUndefined()
  })

  it('treats unsupported methods like OPTIONS as unmatched', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        allowMethods: ['GET'],
      },
    )

    const result = await handler.handle(
      new Request('https://example.com/ping', { method: 'OPTIONS' }),
    )

    expect(result.matched).toBe(false)
    expect(result.response).toBeUndefined()
  })

  it('allows GET requests when allowMethods includes GET', async () => {
    const handler = new RPCHandler(
      {
        ping: os.handler(() => 'pong'),
      },
      {
        allowMethods: ['GET'],
      },
    )

    const result = await handler.handle(
      new Request(`https://example.com/ping?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(result.matched).toBe(true)
    expect(result.response!.status).toBe(200)
    await expect(result.response!.text()).resolves.toContain('pong')
  })

  it('supports deciding allowMethods per procedure', async () => {
    const allowMethods = vi.fn((method: string, _procedure: unknown, path: string[]) => method === 'GET' && path[0] === 'public')

    const handler = new RPCHandler(
      {
        public: os.handler(() => 'public'),
        private: os.handler(() => 'private'),
      },
      {
        allowMethods,
      },
    )

    const allowed = await handler.handle(
      new Request(`https://example.com/public?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(allowed.matched).toBe(true)
    expect(allowed.response!.status).toBe(200)
    await expect(allowed.response!.text()).resolves.toContain('public')

    const blocked = await handler.handle(
      new Request(`https://example.com/private?data=${encodeURIComponent(JSON.stringify({ json: null }))}`),
    )

    expect(blocked.matched).toBe(false)
    expect(allowMethods).toHaveBeenCalledTimes(2)
  })
})

describe('rpcHandler with an implemented router wrapped by the builder', () => {
  const contract = { ping: oc.errors({ NOT_FOUND: {} }) }

  const ping = os
    .errors({ NOT_FOUND: {}, INTERNAL_DEBUG: { data: type<{ sql: string }>() } })
    .handler(({ errors }) => {
      throw errors.INTERNAL_DEBUG({ data: { sql: 'SELECT secret' } })
    })

  const implRouter = implement(contract).router({ ping })

  async function callError(router: AnyRouter, path: string, context: Record<string, unknown> = {}) {
    const { response } = await new RPCHandler(router).handle(
      new Request(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: null }),
      }),
      { context },
    )

    const body = await response!.json() as { json: unknown }

    return body.json
  }

  function getHiddenPingErrorMap(router: Lazyable<AnyRouter>) {
    const hiddenContract = getHiddenRouterContract(router) as Record<string, AnyProcedureContract> | undefined

    return hiddenContract?.ping?.['~orpc'].errorMap
  }

  it('applies the contract when served directly', async () => {
    await expect(callError(implRouter, '/ping')).resolves.toMatchObject({ defined: false, code: 'INTERNAL_DEBUG' })
  })

  it('applies the contract through .router', async () => {
    const router = os.router(implRouter)

    expect(getHiddenPingErrorMap(router)).toEqual({ NOT_FOUND: {} })
    await expect(callError(router, '/ping')).resolves.toMatchObject({ defined: false, code: 'INTERNAL_DEBUG' })
  })

  it('applies the contract through a nested .router', async () => {
    const router = os.router({ sub: implRouter })

    expect(getHiddenPingErrorMap(router.sub)).toEqual({ NOT_FOUND: {} })
    await expect(callError(router, '/sub/ping')).resolves.toMatchObject({ defined: false, code: 'INTERNAL_DEBUG' })
  })

  it('applies the contract through .use().router and keeps the builder errors', async () => {
    const router = os
      .$context<{ deny?: boolean }>()
      .errors({ UNAUTHORIZED: {} })
      .use(({ context, errors, next }) => {
        if (context.deny) {
          throw errors.UNAUTHORIZED()
        }

        return next()
      })
      .router(implRouter)

    expect(getHiddenPingErrorMap(router)).toEqual({ UNAUTHORIZED: {}, NOT_FOUND: {} })
    await expect(callError(router, '/ping')).resolves.toMatchObject({ defined: false, code: 'INTERNAL_DEBUG' })
    await expect(callError(router, '/ping', { deny: true })).resolves.toMatchObject({ defined: true, code: 'UNAUTHORIZED' })
  })

  it('applies the contract through .lazy', async () => {
    const router = { sub: os.lazy(async () => ({ default: implRouter })) }

    const { default: loaded } = await unlazy(router.sub)
    expect(getHiddenPingErrorMap(loaded)).toEqual({ NOT_FOUND: {} })
    await expect(callError(router, '/sub/ping')).resolves.toMatchObject({ defined: false, code: 'INTERNAL_DEBUG' })
  })
})
