import type { HttpHandler } from 'msw'
import { oc } from '@orpc/contract'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { RPCHandler } from '@orpc/server/fetch'
import z from 'zod'
import { createRouterUtils } from './router-utils'

const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })
const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

const baseErrorMap = {
  BASE: { data: z.object({ id: z.number().transform(n => `${n}`) }) },
  SIMPLE: {},
}

const contract = {
  ping: oc.input(inputSchema).output(outputSchema).errors(baseErrorMap),
  nested: {
    pong: oc,
  },
}

const utils = createRouterUtils(contract, { baseUrl: '/rpc' })

it('handler', () => {
  const handler = utils.ping.handler(({ input, errors, request, signal, lastEventId }) => {
    expectTypeOf(input).toEqualTypeOf<{ input: string }>()
    expectTypeOf(request).toExtend<Request>()
    expectTypeOf(signal).toEqualTypeOf<AbortSignal | undefined>()
    expectTypeOf(lastEventId).toEqualTypeOf<string | undefined>()

    expectTypeOf(errors.BASE({ data: { id: 1 } }).code).toEqualTypeOf<'BASE'>()
    // @ts-expect-error --- BASE requires data
    errors.BASE()
    // @ts-expect-error --- invalid data
    errors.BASE({ data: { id: 'invalid' } })

    return { output: 123 }
  })

  expectTypeOf(handler).toEqualTypeOf<HttpHandler>()

  // can be async
  utils.ping.handler(async () => ({ output: 123 }))
  // can return a typed error instead of throwing
  utils.ping.handler(({ errors }) => errors.SIMPLE())
  // untyped output when the contract has no output schema
  utils.nested.pong.handler(() => 'anything')

  // @ts-expect-error --- output must match the output schema input type
  utils.ping.handler(() => ({ output: '123' }))
  // @ts-expect-error --- missing output
  utils.ping.handler(() => ({}))
})

it('error', () => {
  expectTypeOf(utils.ping.error('BASE', { data: { id: 1 } })).toEqualTypeOf<HttpHandler>()

  utils.ping.error('SIMPLE')
  utils.ping.error('SIMPLE', { message: 'custom message' })

  // @ts-expect-error --- BASE requires data
  utils.ping.error('BASE')
  // @ts-expect-error --- invalid data
  utils.ping.error('BASE', { data: { id: 'invalid' } })
  // @ts-expect-error --- code must be defined in the contract
  utils.ping.error('NOT_DEFINED')
})

it('loading', () => {
  expectTypeOf(utils.ping.loading).toEqualTypeOf<() => HttpHandler>()
})

it('protocol options', () => {
  createRouterUtils(contract, { protocol: 'openapi', baseUrl: '*/api' })
  // rpc options are the default
  createRouterUtils(contract, { allowMethods: ['GET'] })
  createRouterUtils(contract, { protocol: 'rpc', allowMethods: ['GET'] })

  // @ts-expect-error --- allowMethods is rpc-only
  createRouterUtils(contract, { protocol: 'openapi', allowMethods: ['GET'] })
  // @ts-expect-error --- invalid protocol
  createRouterUtils(contract, { protocol: 'invalid' })
})

it('handler option', () => {
  createRouterUtils(contract, { handler: router => new RPCHandler(router) })
  createRouterUtils(contract, { protocol: 'openapi', handler: router => new OpenAPIHandler(router) })

  // @ts-expect-error --- must return a fetch handler
  createRouterUtils(contract, { handler: () => ({}) })
})
