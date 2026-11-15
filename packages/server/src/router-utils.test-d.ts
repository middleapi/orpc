import type { MergedErrorMap, Schema } from '@orpc/contract'

import type { MergedInitialContext } from './context'
import type { Lazy, Lazyable } from './lazy'
import type { Procedure } from './procedure'
import type { AnyRouter } from './router'
import type {
  AugmentedRouter,
  AugmentedRouterWithMiddlewares,
  UnlaziedRouter,
} from './router-utils'

describe('AugmentedRouter', () => {
  const router = {
    ping: {} as Procedure<
      { i: 1 },
      { c: 2 },
      Schema<number>,
      Schema<string>,
      { E1: { message: string } }
    >,
    nested: {
      pong: {} as Procedure<{ i: 1 }, object, Schema<number>, Schema<string>, object>,
    },
  }

  it('signal procedure', () => {
    type ErrorMap = { E2: { message: string } }

    expectTypeOf<AugmentedRouter<typeof router.ping, ErrorMap>>().toEqualTypeOf<
      Procedure<
        { i: 1 },
        { c: 2 },
        Schema<number>,
        Schema<string>,
        MergedErrorMap<ErrorMap, { E1: { message: string } }>
      >
    >()
  })

  it('nested router', () => {
    type ErrorMap = { E2: { message: string } }

    expectTypeOf<AugmentedRouter<typeof router, ErrorMap>>().toEqualTypeOf<{
      ping: Procedure<
        { i: 1 },
        { c: 2 },
        Schema<number>,
        Schema<string>,
        MergedErrorMap<ErrorMap, { E1: { message: string } }>
      >
      nested: {
        pong: Procedure<
          { i: 1 },
          object,
          Schema<number>,
          Schema<string>,
          MergedErrorMap<ErrorMap, object>
        >
      }
    }>()
  })

  it('lazy router', () => {
    type ErrorMap = { E2: { message: string } }

    const lazyRouter = {
      lazy: {} as Lazy<typeof router>,
    }

    expectTypeOf<AugmentedRouter<typeof lazyRouter, ErrorMap>>().toEqualTypeOf<{
      lazy: Lazy<{
        ping: Procedure<
          { i: 1 },
          { c: 2 },
          Schema<number>,
          Schema<string>,
          MergedErrorMap<ErrorMap, { E1: { message: string } }>
        >
        nested: {
          pong: Procedure<
            { i: 1 },
            object,
            Schema<number>,
            Schema<string>,
            MergedErrorMap<ErrorMap, object>
          >
        }
      }>
    }>()
  })

  it('lazyable and optional keys', () => {
    type ErrorMap = { E2: { message: string } }

    type Ping = AugmentedRouter<typeof router.ping, ErrorMap>
    type Nested = AugmentedRouter<typeof router.nested, ErrorMap>

    expectTypeOf<
      AugmentedRouter<
        { ping: Lazyable<typeof router.ping>; nested?: Lazyable<typeof router.nested> },
        ErrorMap
      >
    >().toEqualTypeOf<{
      ping: Ping | Lazy<Ping>
      nested?: Nested | Lazy<Nested> | undefined
    }>()
  })

  it('is a router for any router', () => {
    type ErrorMap = { E2: { message: string } }

    expectTypeOf<AugmentedRouter<any, ErrorMap>>().toExtend<AnyRouter>()
    expectTypeOf<AugmentedRouter<AnyRouter, ErrorMap>>().toExtend<AnyRouter>()
  })
})

describe('AugmentedRouterWithMiddlewares', () => {
  const router = {
    ping: {} as Procedure<
      { i: 1 },
      { c: 2 },
      Schema<number>,
      Schema<string>,
      { E1: { message: string } }
    >,
    nested: {
      pong: {} as Procedure<{ i: 1 }, object, Schema<number>, Schema<string>, object>,
    },
  }

  it('signal procedure', () => {
    type ErrorMap = { E2: { message: string } }
    type TInitialContext = { baseI: string }
    type TInjectedContext = { baseC: number }

    expectTypeOf<
      AugmentedRouterWithMiddlewares<
        typeof router.ping,
        TInitialContext,
        TInjectedContext,
        ErrorMap
      >
    >().toEqualTypeOf<
      Procedure<
        MergedInitialContext<TInitialContext, TInjectedContext, { i: 1 }>,
        { c: 2 },
        Schema<number>,
        Schema<string>,
        MergedErrorMap<ErrorMap, { E1: { message: string } }>
      >
    >()
  })

  it('nested router', () => {
    type ErrorMap = { E2: { message: string } }
    type TInitialContext = { baseI: string }
    type TInjectedContext = { baseC: number }

    expectTypeOf<
      AugmentedRouterWithMiddlewares<typeof router, TInitialContext, TInjectedContext, ErrorMap>
    >().toEqualTypeOf<{
      ping: Procedure<
        MergedInitialContext<TInitialContext, TInjectedContext, { i: 1 }>,
        { c: 2 },
        Schema<number>,
        Schema<string>,
        MergedErrorMap<ErrorMap, { E1: { message: string } }>
      >
      nested: {
        pong: Procedure<
          MergedInitialContext<TInitialContext, TInjectedContext, { i: 1 }>,
          object,
          Schema<number>,
          Schema<string>,
          MergedErrorMap<ErrorMap, object>
        >
      }
    }>()
  })

  it('lazy router', () => {
    type ErrorMap = { E2: { message: string } }
    type TInitialContext = { baseI: string }
    type TInjectedContext = { baseC: number }

    const lazyRouter = {
      lazy: {} as Lazy<typeof router>,
    }

    expectTypeOf<
      AugmentedRouterWithMiddlewares<typeof lazyRouter, TInitialContext, TInjectedContext, ErrorMap>
    >().toEqualTypeOf<{
      lazy: Lazy<{
        ping: Procedure<
          MergedInitialContext<TInitialContext, TInjectedContext, { i: 1 }>,
          { c: 2 },
          Schema<number>,
          Schema<string>,
          MergedErrorMap<ErrorMap, { E1: { message: string } }>
        >
        nested: {
          pong: Procedure<
            MergedInitialContext<TInitialContext, TInjectedContext, { i: 1 }>,
            object,
            Schema<number>,
            Schema<string>,
            MergedErrorMap<ErrorMap, object>
          >
        }
      }>
    }>()
  })

  it('lazyable and optional keys', () => {
    type ErrorMap = { E2: { message: string } }
    type TInitialContext = { baseI: string }
    type TInjectedContext = { baseC: number }

    type Ping = AugmentedRouterWithMiddlewares<
      typeof router.ping,
      TInitialContext,
      TInjectedContext,
      ErrorMap
    >
    type Nested = AugmentedRouterWithMiddlewares<
      typeof router.nested,
      TInitialContext,
      TInjectedContext,
      ErrorMap
    >

    expectTypeOf<
      AugmentedRouterWithMiddlewares<
        { ping: Lazyable<typeof router.ping>; nested?: Lazyable<typeof router.nested> },
        TInitialContext,
        TInjectedContext,
        ErrorMap
      >
    >().toEqualTypeOf<{
      ping: Ping | Lazy<Ping>
      nested?: Nested | Lazy<Nested> | undefined
    }>()
  })

  it('is a router for any router', () => {
    expectTypeOf<
      AugmentedRouterWithMiddlewares<any, object, object, object>
    >().toExtend<AnyRouter>()
    expectTypeOf<
      AugmentedRouterWithMiddlewares<AnyRouter, object, object, object>
    >().toExtend<AnyRouter>()
  })
})

it('UnlaziedRouter', () => {
  const ping = {} as Procedure<
    { i: 1 },
    { c: 2 },
    Schema<number>,
    Schema<string>,
    { E1: { message: string } }
  >
  const pong = {} as Procedure<{ i: 1 }, object, Schema<number>, Schema<string>, object>

  const router = {
    ping,
    pong: {} as Lazy<typeof pong>,
    nested: {} as Lazy<{
      ping: typeof ping
      pong: Lazy<typeof pong>
    }>,
    lazyable: {} as Lazyable<{
      ping: typeof ping
      pong: Lazyable<typeof pong>
    }>,
  }

  type Unlazied = UnlaziedRouter<typeof router>

  expectTypeOf<Unlazied>().toEqualTypeOf({
    ping,
    pong,
    nested: {
      ping,
      pong,
    },
    lazyable: {
      ping,
      pong,
    },
  })

  expectTypeOf<
    UnlaziedRouter<{ ping?: Lazy<typeof ping>; nested?: Lazyable<{ ping?: typeof ping }> }>
  >().toEqualTypeOf<{
    ping?: typeof ping | undefined
    nested?: { ping?: typeof ping | undefined } | undefined
  }>()
})
