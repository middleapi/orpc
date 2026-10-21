import type { RegisteredTool, ServerContext } from '@modelcontextprotocol/server'
import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure, StandardLazyRequest } from '@orpc/server'
import type { McpRegistered } from './registrar'
import { McpServer } from '@modelcontextprotocol/server'
import { oc } from '@orpc/contract'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { OpenAPIJsonSerializer, OpenAPISerializer } from '@orpc/openapi'
import { implement, os } from '@orpc/server'
import { z } from 'zod'
import { McpRegistrar } from './registrar'

const server = new McpServer({ name: 'test-server', version: '1.0.0' })

describe('mcpRegistrar', () => {
  it('returns the registered tools by name', () => {
    expectTypeOf(new McpRegistrar({ ping: os.handler(() => 'pong') }).register(server)).toEqualTypeOf<Promise<McpRegistered>>()

    expectTypeOf<McpRegistered>().toEqualTypeOf<{
      tools: Record<string, RegisteredTool>
    }>()
  })

  it('accepts procedures, routers, nested lazy routers, and implemented contracts', () => {
    void new McpRegistrar(os.handler(() => {}))
    void new McpRegistrar({ planet: { list: os.handler(() => []) } })
    void new McpRegistrar({ planet: os.lazy(() => Promise.resolve({ default: { list: os.handler(() => []) } })) })

    // @ts-expect-error a lazy root router is not accepted, create the registrar lazily instead
    void new McpRegistrar(os.lazy(() => Promise.resolve({ default: { list: os.handler(() => []) } })))

    const contract = { ping: oc.input(z.object({ id: z.number() })) }
    void new McpRegistrar(implement(contract).router({ ping: implement(contract).ping.handler(() => {}) }))

    // @ts-expect-error contracts are not implemented
    void new McpRegistrar(contract)
  })

  it('requires the initial context at registration when the router needs one', () => {
    const registrar = new McpRegistrar({
      ping: os.$context<{ auth: string }>().handler(() => 'pong'),
    })

    void registrar.register(server, { context: { auth: 'token' } })
    void registrar.register(server, { context: async () => ({ auth: 'token' }) })

    void registrar.register(server, {
      context: (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<ServerContext>()
        return { auth: ctx.http?.req?.headers.get('authorization') ?? '' }
      },
    })

    // @ts-expect-error context is required
    void registrar.register(server)
    // @ts-expect-error context is required
    void registrar.register(server, {})
    // @ts-expect-error context does not match
    void registrar.register(server, { context: { auth: 123 } })
  })

  it('makes context optional when the initial context can be empty', () => {
    void new McpRegistrar({ ping: os.$context<{ auth?: string }>().handler(() => 'pong') }).register(server)
    void new McpRegistrar({ ping: os.handler(() => 'pong') }).register(server, { context: {} })
  })

  it('takes context at registration, not construction', () => {
    // @ts-expect-error context is provided to register
    void new McpRegistrar({ ping: os.handler(() => 'pong') }, { context: {} })
  })

  it('types interceptors with the initial context', () => {
    void new McpRegistrar({ ping: os.$context<{ auth: string }>().handler(() => 'pong') }, {
      interceptors: [
        ({ next, context }) => {
          expectTypeOf(context.auth).toEqualTypeOf<string>()
          return next()
        },
      ],
    })
  })

  it('types the filter and standard handler options', () => {
    void new McpRegistrar({ ping: os.$context<{ auth: string }>().handler(() => 'pong') }, {
      filter: (contract, path) => {
        expectTypeOf(contract).toEqualTypeOf<AnyProcedureContract | AnyProcedure>()
        expectTypeOf(path).toEqualTypeOf<string[]>()
        return true
      },
      clientInterceptors: [
        ({ next, path, context }) => {
          expectTypeOf(path).toEqualTypeOf<string[]>()
          expectTypeOf(context.auth).toEqualTypeOf<string>()
          return next()
        },
      ],
      interceptors: [
        ({ next, request, context }) => {
          expectTypeOf(request).toEqualTypeOf<StandardLazyRequest>()
          expectTypeOf(context.auth).toEqualTypeOf<string>()
          return next()
        },
      ],
      routingInterceptors: [
        ({ next, request, context }) => {
          expectTypeOf(request).toEqualTypeOf<StandardLazyRequest>()
          expectTypeOf(context.auth).toEqualTypeOf<string>()
          return next()
        },
      ],
      plugins: [new SmartCoercionHandlerPlugin()],
    })

    void new McpRegistrar({ ping: os.handler(() => 'pong') }, { serializer: new OpenAPIJsonSerializer() })
    void new McpRegistrar({ ping: os.handler(() => 'pong') }, { serializer: new OpenAPISerializer() })
    // @ts-expect-error not a JSON serializer
    void new McpRegistrar({ ping: os.handler(() => 'pong') }, { serializer: { serialize: (data: unknown) => data } })
  })
})
