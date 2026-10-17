import type { InitialInputSchema, Schema } from '@orpc/contract'
import type { DecoratedProcedure, DefaultInitialContext, ORPCErrorConstructorMap, ProcedureHandler } from '@orpc/server'
import type { WithEffectContext } from './context'
import type { AnyHandlerGen, HandlerGen } from './handler'
import { ORPCError, os } from '@orpc/server'
import { Context, Effect } from 'effect'
import { z } from 'zod'
import { handlerGen } from './handler'

class Service1 extends Context.Service<
  Service1,
  {
    readonly id: 'Service1'
  }
>()('Service1') {}

class Service2 extends Context.Service<
  Service2,
  {
    readonly id: 'Service2'
  }
>()('Service2') {}

const errorMap = {
  BASE: {
    data: z.object({ id: z.string() }),
    message: 'base',
  },
}

const schema1 = z.object({ schema1: z.number().transform(n => `${n}`) })
const schema2 = z.object({ schema2: z.number().transform(n => `${n}`) })

describe('handlerGen', () => {
  it('works with pure os.handler', () => {
    const procedure = os
      .handler(handlerGen(function* () {
        // use error that has properties that ORPCError doesn't have.
        yield* Effect.fail({ _tags: 'e', non_exists_in_ORPCError: 'abc' })

        yield* Effect.fail(new ORPCError('CONFLICT', { data: 1 }))

        return true
      }))

    expectTypeOf(procedure).toEqualTypeOf<
      DecoratedProcedure<
        DefaultInitialContext & object,
        object,
        InitialInputSchema,
        Schema<boolean>,
        Record<never, never>
      >
    >()
  })

  it('can infer correct context, input, output, errors', async () => {
    const procedure = os
      .$context<{ auth: boolean }>()
      .input(schema1)
      .output(schema2)
      .errors(errorMap)
      .use(({ next }) => next({ context: { extra: true } }))
      .handler(handlerGen(function* ({ input, context, errors }) {
        expectTypeOf(input).toEqualTypeOf<{ schema1: string }>()
        expectTypeOf(context).toEqualTypeOf<{ auth: boolean } & { extra: boolean } & object>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<typeof errorMap>>()

        // use error that has properties that ORPCError doesn't have.
        yield* Effect.fail({ _tags: 'e', non_exists_in_ORPCError: 'abc' })
        yield* Effect.fail(new ORPCError('CONFLICT', { data: 1 }))

        return { schema2: 123 }
      }))

    expectTypeOf(procedure).toEqualTypeOf<
      DecoratedProcedure<
        { auth: boolean } & object,
        object & { extra: boolean },
        typeof schema1,
        typeof schema2,
        typeof errorMap
      >
    >()

    void os
      .$context<{ auth: boolean }>()
      .input(schema1)
      .output(schema2)
      .errors(errorMap)
      .use(({ next }) => next({ context: { extra: true } }))
      // @ts-expect-error - invalid output
      .handler(handlerGen(function* () {
        return 'invalid'
      }))
  })

  it('can strict dependant-effect-service with WithEffectContext', async () => {
    void os
      .$context<WithEffectContext<Service1>>()
      .handler(handlerGen(function* () {
        yield* Service1
      }))

    void os
      .$context<WithEffectContext<Service1>>()
      // @ts-expect-error - Random2 is not provided
      .handler(handlerGen(function* () {
        yield* Service2
      }))
  })

  describe('explicit type arguments', () => {
    interface ServerContext extends WithEffectContext<Service1> {
      auth: boolean
    }

    type Input = { input: string }
    type Output = { output: number }
    type Errors = ORPCErrorConstructorMap<typeof errorMap>
    type Yield = Effect.Effect<any, 'yield-error', Service1>

    it('follows ProcedureHandler order with TYield last', () => {
      const handler = handlerGen<ServerContext, Input, Output, Errors, Yield>(function* ({ context, errors }, input) {
        expectTypeOf(context).toEqualTypeOf<ServerContext>()
        expectTypeOf(input).toEqualTypeOf<Input>()
        expectTypeOf(errors).toEqualTypeOf<Errors>()

        yield* Service1
        yield* Effect.fail('yield-error' as const)

        return { output: 1 }
      })

      expectTypeOf(handler).toEqualTypeOf<ProcedureHandler<ServerContext, Input, Output, Errors>>()

      expectTypeOf<Parameters<typeof handlerGen<ServerContext, Input, Output, Errors, Yield>>[0]>()
        .toEqualTypeOf<HandlerGen<ServerContext, Input, Output, Errors, Yield>>()

      expectTypeOf<HandlerGen<ServerContext, Input, Output, Errors, Yield>>().toExtend<AnyHandlerGen>()

      // @ts-expect-error - error is not in TYield
      handlerGen<ServerContext, Input, Output, Errors, Yield>(function* () {
        yield* Effect.fail('other-error' as const)
        return { output: 1 }
      })

      // @ts-expect-error - Service2 is not provided by ServerContext
      handlerGen<ServerContext, Input, Output, Errors, Effect.Effect<any, any, Service2>>(function* () {
        return { output: 1 }
      })
    })

    it('defaults omitted type arguments', () => {
      const handler = handlerGen<ServerContext>(function* ({ input, errors }) {
        expectTypeOf(input).toEqualTypeOf<unknown>()
        expectTypeOf(errors).toEqualTypeOf<ORPCErrorConstructorMap<Record<never, never>>>()

        yield* Service1

        return 'output'
      })

      // @ts-expect-error - Service2 is not provided by ServerContext
      handlerGen<ServerContext>(function* () {
        yield* Service2
      })

      expectTypeOf(handler).toEqualTypeOf<
        ProcedureHandler<ServerContext, unknown, unknown, ORPCErrorConstructorMap<Record<never, never>>>
      >()

      const procedure = os
        .$context<ServerContext>()
        .input(schema1)
        .errors(errorMap)
        .handler(handler)

      expectTypeOf(procedure).toEqualTypeOf<
        DecoratedProcedure<
          ServerContext & object,
          object,
          typeof schema1,
          Schema<unknown>,
          typeof errorMap
        >
      >()
    })
  })
})
