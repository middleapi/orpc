import type { AnyNestedClient, Client, InferClientContext } from '@orpc/client'
import { RPCSerializer } from '@orpc/client'
import type { ORPCErrorFromErrorMap } from '@orpc/contract'
import { OpenAPISerializer } from '@orpc/openapi'
import type { RouterClient } from '@orpc/server'
import { os } from '@orpc/server'
import type { Public } from '@orpc/shared'
import * as z from 'zod'

import type { ProcedureUtils, ProcedureUtilsOptions } from './procedure-utils'
import type { RouterUtils, RouterUtilsScoped } from './router-utils'
import { createRouterUtils } from './router-utils'
import type { SharedUtils } from './shared-utils'

const inputSchema = z.object({ input: z.number().transform((n) => `${n}`) })
const outputSchema = z.object({ output: z.number().transform((n) => `${n}`) })
const unknownSchema = z.unknown()

const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

const ping = os
  .input(inputSchema)
  .output(outputSchema)
  .errors(baseErrorMap)
  .handler(() => ({ output: 1 }))
const pong = os
  .input(unknownSchema)
  .output(unknownSchema)
  .handler(() => 'pong')

const router = {
  ping,
  pong,
  nested: os.router({
    ping,
    pong,
  }),
}

type OptionalClient = {
  ping?: Client<{ batch?: boolean }, string, number, Error>
  nested?: {
    pong?: Client<{ batch?: boolean }, string, number, Error>
  }
}

describe('RouterUtils', () => {
  it('maps procedures', () => {
    const utils = {} as RouterUtils<RouterClient<typeof router, { batch?: boolean }>>

    expectTypeOf(utils).toExtend<Public<SharedUtils<unknown>>>()
    expectTypeOf(utils.nested).toExtend<Public<SharedUtils<unknown>>>()

    expectTypeOf(utils.ping).toExtend<Public<SharedUtils<{ input: number }>>>()
    expectTypeOf(utils.nested.ping).toExtend<Public<SharedUtils<{ input: number }>>>()

    expectTypeOf(utils.ping).toExtend<
      Public<
        ProcedureUtils<
          { batch?: boolean },
          { input: number },
          { output: string },
          ORPCErrorFromErrorMap<typeof baseErrorMap> | Error
        >
      >
    >()
    expectTypeOf(utils.nested.ping).toExtend<
      Public<
        ProcedureUtils<
          { batch?: boolean },
          { input: number },
          { output: string },
          ORPCErrorFromErrorMap<typeof baseErrorMap> | Error
        >
      >
    >()

    expectTypeOf(utils.pong).toExtend<
      Public<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>>
    >()
    expectTypeOf(utils.nested.pong).toExtend<
      Public<ProcedureUtils<{ batch?: boolean }, unknown, unknown, Error>>
    >()
  })

  it('maps optional procedures', () => {
    const utils = {} as RouterUtils<OptionalClient>

    expectTypeOf(utils.ping).toEqualTypeOf<
      Public<ProcedureUtils<{ batch?: boolean }, string, number, Error>> | undefined
    >()
    expectTypeOf(utils.nested?.pong).toEqualTypeOf<
      Public<ProcedureUtils<{ batch?: boolean }, string, number, Error>> | undefined
    >()
  })

  it('maps with a recursive contextual type', () => {
    // Inferring `T` must not flow back through the recursive mapped type, or TS fails with TS2321.
    type Recursive = { [k: string]: Recursive } | object
    type Options<T extends AnyNestedClient> = { context?: InferClientContext<T> }
    const client = {} as RouterClient<typeof router, { batch?: boolean }>

    const utils = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => RouterUtils<T>
    const _utils: Recursive = utils(client, { context: {} })
  })
})

describe('RouterUtilsScoped', () => {
  it('maps optional procedures', () => {
    const scoped = {} as RouterUtilsScoped<OptionalClient>

    expectTypeOf(scoped.ping).toEqualTypeOf<
      ProcedureUtilsOptions<{ batch?: boolean }, string, number, Error> | undefined
    >()
    expectTypeOf(scoped.nested?.pong).toEqualTypeOf<
      ProcedureUtilsOptions<{ batch?: boolean }, string, number, Error> | undefined
    >()
  })

  it('maps with a recursive contextual type', () => {
    // Inferring `T` must not flow back through the recursive mapped type, or TS fails with TS2321.
    type Recursive = { [k: string]: Recursive } | object
    type Options<T extends AnyNestedClient> = { context?: InferClientContext<T> }
    const client = {} as RouterClient<typeof router, { batch?: boolean }>

    const scoped = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => RouterUtilsScoped<T>
    const _scoped: Recursive = scoped(client, { context: {} })
  })
})

describe('createRouterUtils', () => {
  it('infers router utils', () => {
    const utils = createRouterUtils({} as RouterClient<typeof router, { batch?: boolean }>, {
      prefix: '__prefix__',
      serializer: new RPCSerializer(),
      queryInterceptors: [
        ({ next, context, path }) => {
          expectTypeOf(context.batch).toEqualTypeOf<boolean | undefined>()
          expectTypeOf(path).toEqualTypeOf<string[]>()

          return next()
        },
      ],
      mutationInterceptors: [
        ({ next, context }) => {
          expectTypeOf(context.batch).toEqualTypeOf<boolean | undefined>()

          return next()
        },
      ],
      scoped: {
        nested: {
          ping: {
            mutationOptions: {
              onSuccess: (output) => {
                expectTypeOf(output).toEqualTypeOf<{ output: string }>()
              },
            },
          },
        },
      },
      plugins: [
        {
          name: 'test-plugin',
          init: (options) => options,
          initProcedureOptions: (path, options) => {
            expectTypeOf(path).toEqualTypeOf<string[]>()

            return options
          },
        },
      ],
    })

    expectTypeOf(utils).toEqualTypeOf<
      RouterUtils<RouterClient<typeof router, { batch?: boolean }>>
    >()
  })

  it('accepts an OpenAPI serializer', () => {
    createRouterUtils({} as RouterClient<typeof router>, { serializer: new OpenAPISerializer() })
  })
})

it('createRouterUtils infers the union of contexts when procedures require different contexts', () => {
  const client = {} as {
    a: Client<{ x: string }, string, number, Error>
    b: { c: Client<{ y: number }, string, number, Error> }
  }

  createRouterUtils(client, {
    queryInterceptors: [
      ({ context, next }) => {
        expectTypeOf(context).not.toBeNever()
        expectTypeOf(context).toExtend<{ x: string } | { y: number }>()

        return next()
      },
    ],
  })
})

it('createRouterUtils accepts a client with a `never` input procedure', () => {
  const router = {
    never: os.input(z.never()).handler(() => 1),
    ping,
  }

  const utils = createRouterUtils({} as RouterClient<typeof router, { batch?: boolean }>, {
    queryInterceptors: [
      ({ context, next }) => {
        expectTypeOf(context.batch).toEqualTypeOf<boolean | undefined>()

        return next()
      },
    ],
  })

  expectTypeOf(utils.ping.call).returns.resolves.toEqualTypeOf<{ output: string }>()
})
