import type { AnyORPCError } from '@orpc/client'
import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, StandardLazyRequest } from '@orpc/server'
import type { FetchHandlerHandleResult } from '@orpc/server/fetch'
import type { StandardHandlerPlugin } from '@orpc/server/standard'
import type { JsonRpcErrorObject } from '../../json-rpc'
import type { JsonRpcCall } from '../standard'
import type { OpenRPCHandlerOptions } from './openrpc-handler'
import { oc } from '@orpc/contract'
import { implement, os } from '@orpc/server'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import { getJsonRpcCall, OpenRPCEnvelopeHandlerPlugin } from '../standard'
import { OpenRPCHandler } from './openrpc-handler'

interface InitialContext {
  db: string
}

const base = os.$context<InitialContext>()

const router = {
  ping: base.handler(() => 'pong'),
  nested: {
    pong: base.handler(() => 'ping'),
  },
}

describe('openRPCHandler', () => {
  it('infers the initial context from the router', () => {
    const handler = new OpenRPCHandler(router)

    expectTypeOf(handler).toEqualTypeOf<OpenRPCHandler<InitialContext & object>>()
    expectTypeOf(handler.handle(new Request('https://example.com'), { context: { db: 'db' } })).toEqualTypeOf<Promise<FetchHandlerHandleResult>>()

    void handler.handle(new Request('https://example.com'), { context: async request => ({ db: request.url }), prefix: '/rpc' })

    // @ts-expect-error - context is required
    void handler.handle(new Request('https://example.com'))
    // @ts-expect-error - invalid context
    void handler.handle(new Request('https://example.com'), { context: { db: 1 } })
    // @ts-expect-error - prefix must start with a slash
    void handler.handle(new Request('https://example.com'), { context: { db: 'db' }, prefix: 'rpc' })
  })

  it('makes the context optional when the router needs none', () => {
    const handler = new OpenRPCHandler({ ping: os.handler(() => 'pong') })

    void handler.handle(new Request('https://example.com'))
    void handler.handle(new Request('https://example.com'), { prefix: '/rpc' })
  })

  it('accepts lazy routers and implemented contracts', () => {
    void new OpenRPCHandler({ planet: os.lazy(() => Promise.resolve({ default: router })) })

    const impl = implement({ ping: oc })
    void new OpenRPCHandler(impl.router({ ping: impl.ping.handler(() => 'pong') }))
  })

  it('does not infer the context from the options', () => {
    void new OpenRPCHandler(router, {
      maxBatchSize: ({ context, request, prefix }) => {
        expectTypeOf(context).toEqualTypeOf<InitialContext & object>()
        expectTypeOf(request).toEqualTypeOf<StandardLazyRequest>()
        expectTypeOf(prefix).toEqualTypeOf<`/${string}` | undefined>()

        return context.db === 'admin' ? 1000 : 10
      },
      routingInterceptors: [
        async ({ context, request, next }) => {
          expectTypeOf(context).toEqualTypeOf<InitialContext & object>()
          expectTypeOf(getJsonRpcCall(request)).toEqualTypeOf<JsonRpcCall | undefined>()

          return next()
        },
      ],
      plugins: [new CORSHandlerPlugin<InitialContext>()],
    })

    void new OpenRPCHandler(router, {
      // @ts-expect-error - the plugin needs another context than the router
      plugins: [new CORSHandlerPlugin<{ other: number }>({ origin: (_, { context }) => String(context.other) })],
    })
  })

  it('types the option callbacks', () => {
    void new OpenRPCHandler(router, {
      filter: (procedure, path) => {
        expectTypeOf(procedure).toEqualTypeOf<AnyProcedureContract | AnyProcedure>()
        expectTypeOf(path).toEqualTypeOf<string[]>()

        return path[0] !== 'nested'
      },
      customErrorEncoder: (error) => {
        expectTypeOf(error).toEqualTypeOf<AnyORPCError>()

        return error.code === 'NOT_FOUND' ? { code: 404, message: error.message } : undefined
      },
    })

    void new OpenRPCHandler(router, { filter: false, maxBatchSize: 0, errorResponseStatus: 'mapped' })
    void new OpenRPCHandler(router, { maxBatchSize: async () => 10, errorResponseStatus: 'always-200' })
  })

  it('rejects invalid options', () => {
    // @ts-expect-error - unknown error response status mode
    void new OpenRPCHandler(router, { errorResponseStatus: 'always-500' })
    // @ts-expect-error - JSON-RPC error codes are numbers
    void new OpenRPCHandler(router, { errorCodeMap: { NOT_FOUND: '-32004' } })
    // @ts-expect-error - maxBatchSize is a number
    void new OpenRPCHandler(router, { maxBatchSize: '10' })
    // @ts-expect-error - the custom error encoder returns a JSON-RPC error object
    void new OpenRPCHandler(router, { customErrorEncoder: () => ({ code: '1', message: 'x' }) })
  })

  it('accepts the envelope plugin on its own', () => {
    expectTypeOf(new OpenRPCEnvelopeHandlerPlugin<InitialContext>()).toExtend<StandardHandlerPlugin<InitialContext>>()
    expectTypeOf<OpenRPCHandlerOptions<InitialContext>['customErrorEncoder']>().toEqualTypeOf<
      ((error: AnyORPCError) => JsonRpcErrorObject | null | undefined) | undefined
    >()
  })
})
