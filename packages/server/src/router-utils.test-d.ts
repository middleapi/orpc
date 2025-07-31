import type { MergedErrorMap, Meta, Schema } from '@orpc/contract'
import type { baseErrorMap, BaseMeta, inputSchema, outputSchema } from '../../contract/tests/shared'
import type { CurrentContext, InitialContext, router } from '../tests/shared'
import type { Context, MergedInitialContext } from './context'
import type { Lazy } from './lazy'
import type { Procedure } from './procedure'
import type { AccessibleLazyRouter, EnhancedRouter, UnlaziedRouter } from './router-utils'
import { ping, pong } from '../tests/shared'

it('AccessibleLazyRouter', () => {
  type Accessible = AccessibleLazyRouter<Lazy<typeof router>>

  expectTypeOf<Accessible['ping']>().toEqualTypeOf<Lazy<typeof ping>>()
  expectTypeOf<Accessible['nested']['ping']>().toEqualTypeOf<Lazy<typeof ping>>()

  expectTypeOf<Accessible['pong']>().toEqualTypeOf<Lazy<typeof pong>>()
  expectTypeOf<Accessible['nested']['pong']>().toEqualTypeOf<Lazy<typeof pong>>()
})

it('EnhancedRouter', () => {
  type TErrorMap = { INVALID: { message: string }, OVERRIDE: { message: string } }
  type InitialContext2 = { auth?: boolean, user?: string }
  type CurrentContext2 = { auth?: boolean, user?: string, db?: string, extra?: string }
  type Enhanced = EnhancedRouter<typeof router, InitialContext2, CurrentContext2, TErrorMap>

  expectTypeOf<Enhanced['ping']>().toEqualTypeOf<
    Lazy<
      Procedure<
        MergedInitialContext<InitialContext2, InitialContext, CurrentContext2>,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<TErrorMap, typeof baseErrorMap>,
        BaseMeta
      >
    >
  >()

  expectTypeOf<Enhanced['nested']['ping']>().toEqualTypeOf<
    Lazy<
      Procedure<
        MergedInitialContext<InitialContext2, InitialContext, CurrentContext2>,
        CurrentContext,
        typeof inputSchema,
        typeof outputSchema,
        MergedErrorMap<TErrorMap, typeof baseErrorMap>,
        BaseMeta
      >
    >
  >()

  expectTypeOf<Enhanced['pong']>().toEqualTypeOf<
    Procedure<
      MergedInitialContext<InitialContext2, Context, CurrentContext2>,
      Context,
      Schema<unknown, unknown>,
      Schema<unknown, unknown>,
      MergedErrorMap<TErrorMap, Record<never, never>>,
      Meta
    >
  >()

  expectTypeOf<Enhanced['nested']['pong']>().toEqualTypeOf<
    Lazy<
      Procedure<
        MergedInitialContext<InitialContext2, Context, CurrentContext2>,
        Context,
        Schema<unknown, unknown>,
        Schema<unknown, unknown>,
        MergedErrorMap<TErrorMap, Record<never, never>>,
        Meta
      >
    >
  >()
})

it('UnlaziedRouter', () => {
  type Unlazied = UnlaziedRouter<typeof router>

  expectTypeOf<Unlazied>().toEqualTypeOf({
    ping,
    pong,
    nested: {
      ping,
      pong,
    },
  })
})
