import type { ChainableImplementer } from './implementer-chainable'
import type { DecoratedLazy } from './lazy-decorated'
import type { Middleware, MiddlewareMeta } from './middleware'
import type { DecoratedMiddleware } from './middleware-decorated'
import type { ANY_PROCEDURE, Procedure } from './procedure'
import type { ProcedureBuilder } from './procedure-builder'
import type { DecoratedProcedure } from './procedure-decorated'
import type { AdaptedRouter, RouterBuilder } from './router-builder'
import type { Meta, WELL_CONTEXT } from './types'
import { oc } from '@orpc/contract'
import { z } from 'zod'
import { Builder } from './builder'

const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })

const builder = new Builder<{ auth: boolean }, { db: string }>({})

describe('self chainable', () => {
  it('define context', () => {
    expectTypeOf(builder.context()).toEqualTypeOf<Builder<WELL_CONTEXT, undefined>>()
    expectTypeOf(builder.context<{ db: string }>()).toEqualTypeOf<Builder<{ db: string }, undefined>>()
    expectTypeOf(builder.context<{ auth: boolean }>()).toEqualTypeOf<Builder<{ auth: boolean }, undefined>>()
  })

  it('use middleware', () => {
    expectTypeOf(
      builder.use({} as Middleware<{ auth: boolean }, undefined, unknown, unknown>),
    ).toEqualTypeOf<Builder<{ auth: boolean }, { db: string }>>()
    expectTypeOf(
      builder.use({} as Middleware<{ auth: boolean }, { dev: string }, unknown, unknown>),
    ).toEqualTypeOf<Builder<{ auth: boolean }, { db: string } & { dev: string }>>()
    expectTypeOf(
      builder.use({} as Middleware<WELL_CONTEXT, undefined, unknown, unknown>),
    ).toEqualTypeOf<Builder<{ auth: boolean }, { db: string }>>()

    // @ts-expect-error - context is not match
    builder.use({} as Middleware<{ auth: 'invalid' }, undefined, unknown, unknown>)

    // @ts-expect-error - extra context is conflict with context
    builder.use({} as Middleware<WELL_CONTEXT, { auth: 'invalid' }, unknown, unknown>)

    // @ts-expect-error - expected input is not match with unknown
    builder.use({} as Middleware<WELL_CONTEXT, undefined, number, unknown>)

    // @ts-expect-error - expected output is not match with unknown
    builder.use({} as Middleware<WELL_CONTEXT, undefined, unknown, number>)

    // @ts-expect-error - invalid middleware
    builder.use(() => {})
  })
})

describe('create middleware', () => {
  it('works', () => {
    const mid = builder.middleware((input, context, meta) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<{ auth: boolean } & { db: string }>()
      expectTypeOf(meta).toEqualTypeOf<MiddlewareMeta<any>>()

      return meta.next({
        context: {
          dev: true,
        },
      })
    })

    expectTypeOf(mid).toEqualTypeOf<
      DecoratedMiddleware<{ auth: boolean } & { db: string }, { dev: boolean }, unknown, any>
    >()

    // @ts-expect-error - conflict extra context and context
    builder.middleware((input, context, meta) => meta.next({
      context: {
        auth: 'invalid',
      },
    }))
  })
})

describe('to ProcedureBuilder', () => {
  it('route', () => {
    expectTypeOf(builder.route({ path: '/test', method: 'GET' })).toEqualTypeOf<
      ProcedureBuilder<{ auth: boolean }, { db: string }, undefined, undefined>
    >()

    // @ts-expect-error - invalid path
    builder.route({ path: '' })

    // @ts-expect-error - invalid method
    builder.route({ method: '' })
  })

  it('input', () => {
    expectTypeOf(builder.input(schema, { val: '123' })).toEqualTypeOf<
      ProcedureBuilder<{ auth: boolean }, { db: string }, typeof schema, undefined>
    >()

    builder.input(schema)
    // @ts-expect-error - invalid example
    builder.input(schema, { val: 123 })
    // @ts-expect-error - invalid schema
    builder.input({})
  })

  it('output', () => {
    expectTypeOf(builder.output(schema, { val: 123 })).toEqualTypeOf<
      ProcedureBuilder<{ auth: boolean }, { db: string }, undefined, typeof schema>
    >()

    builder.output(schema)
    // @ts-expect-error - invalid example
    builder.output(schema, { val: '123' })
    // @ts-expect-error - invalid schema
    builder.output({})
  })
})

describe('to DecoratedProcedure', () => {
  it('handler', () => {
    expectTypeOf(builder.handler((input, context, meta) => {
      expectTypeOf(input).toEqualTypeOf<unknown>()
      expectTypeOf(context).toEqualTypeOf<{ auth: boolean } & { db: string }>()
      expectTypeOf(meta).toEqualTypeOf<Meta>()

      return 456
    })).toMatchTypeOf<
      DecoratedProcedure<{ auth: boolean }, { db: string }, undefined, undefined, number>
    >()
  })
})

describe('to RouterBuilder', () => {
  it('prefix', () => {
    expectTypeOf(builder.prefix('/test')).toEqualTypeOf<
      RouterBuilder<{ auth: boolean }, { db: string }>
    >()

    // @ts-expect-error invalid prefix
    builder.prefix('')
  })

  it('tags', () => {
    expectTypeOf(builder.tag('test', 'test2')).toEqualTypeOf<
      RouterBuilder<{ auth: boolean }, { db: string }>
    >()

    // @ts-expect-error invalid tags
    builder.tag(123)
  })
})

it('to AdaptedRouter', () => {
  const ping = {} as Procedure<{ auth: boolean, db: string }, undefined, undefined, undefined, unknown>
  const router = {
    ping,
    nested: {
      ping,
    },
  }
  expectTypeOf(builder.router(router)).toEqualTypeOf<
    AdaptedRouter<{ auth: boolean }, typeof router>
  >()

  // @ts-expect-error - context is not match
  builder.router({ ping: {} as Procedure<{ invalid: true }, undefined, undefined, undefined, unknown> })
})

it('to DecoratedLazy', () => {
  const ping = {} as Procedure<{ auth: boolean, db: string }, undefined, undefined, undefined, unknown>
  const router = {
    ping,
    nested: {
      ping,
    },
  }

  expectTypeOf(
    builder.lazy(() => Promise.resolve({ default: router })),
  ).toEqualTypeOf<
    DecoratedLazy<AdaptedRouter<{ auth: boolean }, typeof router>>
  >()

  // @ts-expect-error - context is not match
  builder.lazy(() => Promise.resolve({ default: {
    ping: {} as Procedure<{ invalid: true }, undefined, undefined, undefined, unknown>,
  } }))
})

it('to ChainableImplementer', () => {
  const schema = z.object({ val: z.string().transform(val => Number(val)) })

  const ping = oc.input(schema).output(schema)
  const pong = oc.route({ method: 'GET', path: '/ping' })

  const contract = oc.router({
    ping,
    pong,
    nested: {
      ping,
      pong,
    },
  })

  expectTypeOf(builder.contract(contract)).toEqualTypeOf<
    ChainableImplementer<{ auth: boolean }, { db: string }, typeof contract>
  >()

  /// @ts-expect-error - context is not match
  builder.contract({} as ANY_PROCEDURE)
})
