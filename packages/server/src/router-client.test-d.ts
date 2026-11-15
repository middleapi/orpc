import type { AnyNestedClient } from '@orpc/client'
import type { Schema } from '@orpc/contract'
import * as z from 'zod'

import { os } from './builder'
import type { Lazyable } from './lazy'
import type { AnyProcedure } from './procedure'
import type { ProcedureClient } from './procedure-client'
import type { RouterClient } from './router-client'
import { createRouterClient } from './router-client'

const errorMap = {
  BASE: {
    data: z.string(),
  },
}

// Schemas should have distinct TInput and TOutput types to ensure correct inference.
const schema1 = z.object({ schema1: z.number().transform((n) => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform((n) => `${n}`) })
const schema3 = z.object({ schema3: z.boolean().transform((n) => `${n}`) })

const router = {
  ping: os
    .input(schema1)
    .output(schema2)
    .handler(() => ({ schema2: 1 })),
  nested: os.router({
    pong: os
      .input(schema3)
      .output(schema2)
      .errors(errorMap)
      .handler(() => ({ schema2: 2 })),
  }),
  lazy: os.lazy(() =>
    Promise.resolve({
      default: {
        peng: os.input(schema1).handler(() => 'output'),
      },
    }),
  ),
}

describe('RouterClient', () => {
  it('deep access', () => {
    const client = {} as RouterClient<typeof router, { cache?: boolean }>

    expectTypeOf(client.ping).toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema1, typeof schema2, object>
    >()

    expectTypeOf(client.nested).toEqualTypeOf<
      RouterClient<typeof router.nested, { cache?: boolean }>
    >()

    expectTypeOf(client.nested.pong).toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema3, typeof schema2, typeof errorMap>
    >()

    expectTypeOf(client.lazy.peng).toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema1, Schema<string>, object>
    >()
  })

  it('unwraps lazy at any depth', () => {
    const lazyRouter = {
      ping: os.lazy(() => Promise.resolve({ default: router.ping })),
      nested: os.lazy(() => Promise.resolve({ default: { lazy: router.lazy } })),
    }
    const client = {} as RouterClient<typeof lazyRouter>

    expectTypeOf(client.ping).toEqualTypeOf<
      ProcedureClient<object, typeof schema1, typeof schema2, object>
    >()

    expectTypeOf(client.nested.lazy.peng).toEqualTypeOf<
      ProcedureClient<object, typeof schema1, Schema<string>, object>
    >()
  })

  it('supports a key that is either lazy or not', () => {
    type LazyableRouter = {
      ping: Lazyable<typeof router.ping>
      nested: Lazyable<typeof router.nested>
    }
    const client = {} as RouterClient<LazyableRouter>

    expectTypeOf(client.ping).toEqualTypeOf<
      ProcedureClient<object, typeof schema1, typeof schema2, object>
    >()

    expectTypeOf(client.nested.pong).toEqualTypeOf<
      ProcedureClient<object, typeof schema3, typeof schema2, typeof errorMap>
    >()
  })

  it('maps optional keys', () => {
    type OptionalRouter = {
      ping?: typeof router.ping
      nested?: { pong?: typeof router.nested.pong }
      lazy?: typeof router.lazy
    }

    expectTypeOf<RouterClient<OptionalRouter>>().toEqualTypeOf<{
      ping?: ProcedureClient<object, typeof schema1, typeof schema2, object> | undefined
      nested?:
        | {
            pong?:
              | ProcedureClient<object, typeof schema3, typeof schema2, typeof errorMap>
              | undefined
          }
        | undefined
      lazy?: { peng: ProcedureClient<object, typeof schema1, Schema<string>, object> } | undefined
    }>()
  })

  it('accepts any client as RouterClient<any>', () => {
    const client = {} as RouterClient<typeof router>

    const _router: RouterClient<any> = client
    const _procedure: RouterClient<any> = client.ping
    const _key: RouterClient<{ ping: any }> = { ping: client.nested.pong }
  })

  it('keeps a generic procedure unresolved', () => {
    async function _generic<T extends AnyProcedure>(client: RouterClient<T>) {
      // @ts-expect-error - output of an unresolved procedure is not a string
      const _output: string = await client(undefined as any)
    }
  })

  it('support single procedure', () => {
    type P = RouterClient<(typeof router)['ping'], { cache?: boolean }>

    expectTypeOf<P>().toEqualTypeOf<
      ProcedureClient<{ cache?: boolean }, typeof schema1, typeof schema2, object>
    >()
  })
})

describe('createRouterClient', () => {
  it('accepts an untyped router', () => {
    const _client: AnyNestedClient = createRouterClient({} as any, {})
  })

  it('can be assigned to a recursive client type while passing context', () => {
    const router = { ping: os.$context<{ db: string }>().handler(() => 1) }

    const _client: AnyNestedClient = createRouterClient(router, { context: { db: 'db' } })
    const _client2: AnyNestedClient = createRouterClient(router, { context: () => ({ db: 'db' }) })
  })
})
