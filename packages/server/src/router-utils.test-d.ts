import type { MergedErrorMap, Schema } from '@orpc/contract'

import type { MergedInitialContext } from './context'
import type { Lazy, Lazyable } from './lazy'
import type { AnyProcedure, Procedure } from './procedure'
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
  it('lazyable router', () => {
    type ErrorMap = { E2: { message: string } }
    type Augmented = AugmentedRouter<typeof router, ErrorMap>

    const lazyableRouter = {
      lazyable: {} as Lazyable<typeof router>,
    }

    expectTypeOf<AugmentedRouter<typeof lazyableRouter, ErrorMap>>().toEqualTypeOf<{
      lazyable: Augmented | Lazy<Augmented>
    }>()
  })

  it('optional keys', () => {
    type ErrorMap = { E2: { message: string } }
    type Augmented = AugmentedRouter<typeof router, ErrorMap>

    type OptionalRouter = {
      ping?: typeof router.ping
      nested?: typeof router.nested
      lazy?: Lazy<typeof router>
      lazyable?: Lazyable<typeof router>
    }

    expectTypeOf<AugmentedRouter<OptionalRouter, ErrorMap>>().toEqualTypeOf<{
      ping?: Augmented['ping']
      nested?: Augmented['nested']
      lazy?: Lazy<Augmented>
      lazyable?: Augmented | Lazy<Augmented>
    }>()
  })

  it('any router', () => {
    type ErrorMap = { E2: { message: string } }
    type Augmented = AugmentedRouter<AnyRouter, ErrorMap>

    expectTypeOf<Augmented>().toExtend<AnyRouter>()
    expectTypeOf<Exclude<Augmented, AnyProcedure>>().toEqualTypeOf<{
      [k: string]: Augmented | Lazy<Augmented>
    }>()
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
  it('lazyable router', () => {
    type ErrorMap = { E2: { message: string } }
    type TInitialContext = { baseI: string }
    type TInjectedContext = { baseC: number }
    type Augmented = AugmentedRouterWithMiddlewares<
      typeof router,
      TInitialContext,
      TInjectedContext,
      ErrorMap
    >

    const lazyableRouter = {
      lazyable: {} as Lazyable<typeof router>,
    }

    expectTypeOf<
      AugmentedRouterWithMiddlewares<
        typeof lazyableRouter,
        TInitialContext,
        TInjectedContext,
        ErrorMap
      >
    >().toEqualTypeOf<{
      lazyable: Augmented | Lazy<Augmented>
    }>()
  })

  it('optional keys', () => {
    type ErrorMap = { E2: { message: string } }
    type TInitialContext = { baseI: string }
    type TInjectedContext = { baseC: number }
    type Augmented = AugmentedRouterWithMiddlewares<
      typeof router,
      TInitialContext,
      TInjectedContext,
      ErrorMap
    >

    type OptionalRouter = {
      ping?: typeof router.ping
      nested?: typeof router.nested
      lazy?: Lazy<typeof router>
      lazyable?: Lazyable<typeof router>
    }

    expectTypeOf<
      AugmentedRouterWithMiddlewares<OptionalRouter, TInitialContext, TInjectedContext, ErrorMap>
    >().toEqualTypeOf<{
      ping?: Augmented['ping']
      nested?: Augmented['nested']
      lazy?: Lazy<Augmented>
      lazyable?: Augmented | Lazy<Augmented>
    }>()
  })

  it('any router', () => {
    type Augmented = AugmentedRouterWithMiddlewares<
      AnyRouter,
      { baseI: string },
      { baseC: number },
      { E2: { message: string } }
    >

    expectTypeOf<Augmented>().toExtend<AnyRouter>()
    expectTypeOf<Exclude<Augmented, AnyProcedure>>().toEqualTypeOf<{
      [k: string]: Augmented | Lazy<Augmented>
    }>()
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
})

it('UnlaziedRouter with optional keys', () => {
  const ping = {} as Procedure<{ i: 1 }, object, Schema<number>, Schema<string>, object>

  type OptionalRouter = {
    ping?: typeof ping
    lazy?: Lazy<typeof ping>
    lazyable?: Lazyable<{ ping?: Lazyable<typeof ping> }>
  }

  expectTypeOf<UnlaziedRouter<OptionalRouter>>().toEqualTypeOf<{
    ping?: typeof ping
    lazy?: typeof ping
    lazyable?: { ping?: typeof ping }
  }>()
})
