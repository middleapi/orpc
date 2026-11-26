import type { ORPCError } from './error'
import type {
  AnyNestedClient,
  Client,
  ClientContext,
  InferClientBodyInputs,
  InferClientBodyOutputs,
  InferClientContext,
  InferClientError,
  InferClientErrors,
  InferClientInputs,
  InferClientOutputs,
} from './types'

describe('client', () => {
  const client: Client<
    { cache?: boolean },
    string,
    number,
    Error | ORPCError<'OVERRIDE', unknown>
  > = async (...args) => {
    const [input, options] = args

    expectTypeOf(input).toEqualTypeOf<string>()
    expectTypeOf(options).toExtend<
      { context?: { cache?: boolean }; signal?: AbortSignal } | undefined
    >()

    return 123
  }

  it('just a function', () => {
    expectTypeOf(client).toExtend<
      (input: string, options: { context?: ClientContext; signal?: AbortSignal }) => Promise<number>
    >()
  })

  it('infer correct input', () => {
    expectTypeOf(client).parameter(0).toEqualTypeOf<string>()

    // @ts-expect-error - input is required
    void client()
  })

  it('optional undefinedable input', () => {
    const client = {} as Client<ClientContext, { val: string } | undefined, { val: number }, Error>

    expectTypeOf(client).parameter(0).toEqualTypeOf<{ val: string } | undefined>()

    void client(undefined)
    void client()
  })

  it('accept signal', () => {
    void client('123', { signal: new AbortSignal() })
    // @ts-expect-error - invalid signal
    void client('123', { signal: 1234 })
  })

  describe('context', () => {
    it('can accept context', () => {
      const client = {} as Client<{ userId: string }, { val: string }, { val: number }, Error>

      void client({ val: '123' }, { context: { userId: '123' } })
      // @ts-expect-error - invalid context
      void client({ val: '123' }, { context: { userId: 123 } })
      // @ts-expect-error - context is required
      void client({ val: '123' })
    })

    it('optional options when context is optional', () => {
      const client = {} as Client<{ userId?: string }, { val: string }, { val: number }, Error>

      void client({ val: '123' })
      void client({ val: '123' }, { context: { userId: '123' } })
    })

    it('optional options when context is an index signature', () => {
      const client = {} as Client<Record<string, unknown>, undefined, { val: number }, Error>

      void client()
      void client(undefined, { context: { any: 1 } })
    })

    it('can call without args when both input and context are optional', () => {
      const client = {} as Client<
        { userId?: string },
        undefined | { val: string },
        { val: number },
        Error
      >

      void client()
      void client({ val: 'string' })
      void client({ val: 'string' }, { context: { userId: '123' } })
      // @ts-expect-error - input is invalid
      void client({ val: 123 }, { context: { userId: '123' } })
      // @ts-expect-error - context is invalid
      void client({ val: '123' }, { context: { userId: 123 } })
    })
  })

  it('infer correct output', async () => {
    expectTypeOf(await client('123')).toEqualTypeOf<number>()
  })

  it('can reverse infer', () => {
    expectTypeOf<
      typeof client extends Client<infer C, infer I, infer O, infer E> ? [C, I, O, E] : never
    >().toEqualTypeOf<
      [{ cache?: boolean }, string, number, Error | ORPCError<'OVERRIDE', unknown>]
    >()
  })
})

type ORPC = {
  ping: Client<{ cache?: boolean }, string, number, Error | ORPCError<'PING', unknown>>
  pong: Client<{ cache?: boolean }, { body: number }, { body: string }, Error>
  nested: {
    ping: Client<{ cache?: boolean }, string, number, Error | ORPCError<'NESTED_PING', unknown>>
    pong: Client<{ cache?: boolean }, { body: number }, { body: string }, Error>
  }
}

type OptionalORPC = {
  ping?: Client<{ cache?: boolean }, string, number, Error>
  nested?: {
    pong?: Client<{ cache?: boolean }, { body: number }, { body: string }, TypeError>
  }
}

// Inferring `T` must not flow back through the recursive mapped types, or TS fails with TS2321.
type Recursive = { [k: string]: Recursive } | object
type Options<T extends AnyNestedClient> = { context?: InferClientContext<T> }

describe('InferClientContext', () => {
  it('infers the context of procedures', () => {
    expectTypeOf<InferClientContext<ORPC>>().toEqualTypeOf<{ cache?: boolean }>()
  })
})

describe('InferClientInputs', () => {
  it('maps procedures', () => {
    expectTypeOf<InferClientInputs<ORPC>>().toEqualTypeOf<{
      ping: string
      pong: { body: number }
      nested: {
        ping: string
        pong: { body: number }
      }
    }>()
  })

  it('maps optional procedures', () => {
    expectTypeOf<InferClientInputs<OptionalORPC>>().toEqualTypeOf<{
      ping?: string | undefined
      nested?: { pong?: { body: number } | undefined } | undefined
    }>()
  })

  it('maps with a recursive contextual type', () => {
    const infer = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => InferClientInputs<T>
    const _: Recursive = infer({} as ORPC, { context: {} })
  })
})

describe('InferClientBodyInputs', () => {
  it('maps procedures', () => {
    expectTypeOf<InferClientBodyInputs<ORPC>>().toEqualTypeOf<{
      ping: string
      pong: number
      nested: {
        ping: string
        pong: number
      }
    }>()
  })

  it('maps optional procedures', () => {
    expectTypeOf<InferClientBodyInputs<OptionalORPC>>().toEqualTypeOf<{
      ping?: string | undefined
      nested?: { pong?: number | undefined } | undefined
    }>()
  })

  it('maps with a recursive contextual type', () => {
    const infer = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => InferClientBodyInputs<T>
    const _: Recursive = infer({} as ORPC, { context: {} })
  })
})

describe('InferClientOutputs', () => {
  it('maps procedures', () => {
    expectTypeOf<InferClientOutputs<ORPC>>().toEqualTypeOf<{
      ping: number
      pong: { body: string }
      nested: {
        ping: number
        pong: { body: string }
      }
    }>()
  })

  it('maps optional procedures', () => {
    expectTypeOf<InferClientOutputs<OptionalORPC>>().toEqualTypeOf<{
      ping?: number | undefined
      nested?: { pong?: { body: string } | undefined } | undefined
    }>()
  })

  it('maps with a recursive contextual type', () => {
    const infer = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => InferClientOutputs<T>
    const _: Recursive = infer({} as ORPC, { context: {} })
  })
})

describe('InferClientBodyOutputs', () => {
  it('maps procedures', () => {
    expectTypeOf<InferClientBodyOutputs<ORPC>>().toEqualTypeOf<{
      ping: number
      pong: string
      nested: {
        ping: number
        pong: string
      }
    }>()
  })

  it('maps optional procedures', () => {
    expectTypeOf<InferClientBodyOutputs<OptionalORPC>>().toEqualTypeOf<{
      ping?: number | undefined
      nested?: { pong?: string | undefined } | undefined
    }>()
  })

  it('maps with a recursive contextual type', () => {
    const infer = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => InferClientBodyOutputs<T>
    const _: Recursive = infer({} as ORPC, { context: {} })
  })
})

describe('InferClientErrors', () => {
  it('maps procedures', () => {
    expectTypeOf<InferClientErrors<ORPC>>().toEqualTypeOf<{
      ping: Error | ORPCError<'PING', unknown>
      pong: Error
      nested: {
        ping: Error | ORPCError<'NESTED_PING', unknown>
        pong: Error
      }
    }>()
  })

  it('maps optional procedures', () => {
    expectTypeOf<InferClientErrors<OptionalORPC>>().toEqualTypeOf<{
      ping?: Error | undefined
      nested?: { pong?: TypeError | undefined } | undefined
    }>()
  })

  it('maps with a recursive contextual type', () => {
    const infer = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => InferClientErrors<T>
    const _: Recursive = infer({} as ORPC, { context: {} })
  })
})

describe('InferClientError', () => {
  it('unions errors of procedures', () => {
    expectTypeOf<InferClientError<ORPC>>().toEqualTypeOf<
      Error | ORPCError<'PING', unknown> | ORPCError<'NESTED_PING', unknown>
    >()
  })

  it('unions errors of optional procedures', () => {
    expectTypeOf<InferClientError<OptionalORPC>>().toEqualTypeOf<Error | TypeError>()
  })

  it('unions with a recursive contextual type', () => {
    const infer = {} as <T extends AnyNestedClient>(
      client: T,
      options: Options<T>,
    ) => InferClientError<T>
    const _: Recursive = infer({} as ORPC, { context: {} })
  })
})
