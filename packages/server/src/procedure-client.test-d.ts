import type { Procedure } from './procedure'
import type { ProcedureClient } from './procedure-client'
import type { Meta, WELL_CONTEXT, WithSignal } from './types'
import { z } from 'zod'
import { lazy } from './lazy'
import { createProcedureClient } from './procedure-client'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ProcedureClient', () => {
  const fn: ProcedureClient<string, number, unknown> = async (...[input, options]) => {
    expectTypeOf(input).toEqualTypeOf<string>()
    expectTypeOf(options).toEqualTypeOf<(WithSignal & { context?: unknown }) | undefined>()
    return 123
  }

  const fnWithOptionalInput: ProcedureClient<string | undefined, number, unknown> = async (...args) => {
    const [input, options] = args

    expectTypeOf(input).toEqualTypeOf<string | undefined>()
    expectTypeOf(options).toEqualTypeOf<(WithSignal & { context?: unknown }) | undefined>()
    return 123
  }

  it('just a function', () => {
    expectTypeOf(fn).toMatchTypeOf<(input: string, options: WithSignal & { context?: unknown }) => Promise<number>>()
    expectTypeOf(fnWithOptionalInput).toMatchTypeOf<(input: string | undefined, options: WithSignal & { context?: unknown }) => Promise<number>>()
  })

  it('infer correct input', () => {
    fn('123')
    fnWithOptionalInput('123')

    // @ts-expect-error - invalid input
    fn(123)
    // @ts-expect-error - invalid input
    fnWithOptionalInput(123)

    // @ts-expect-error - invalid input
    fn({})
    // @ts-expect-error - invalid input
    fnWithOptionalInput({})
  })

  it('accept signal', () => {
    fn('123', { signal: new AbortSignal() })
    fnWithOptionalInput('123', { signal: new AbortSignal() })

    // @ts-expect-error - invalid signal
    fn('123', { signal: 1234 })
    // @ts-expect-error - invalid signal
    fnWithOptionalInput('123', { signal: 1234 })
  })

  it('can accept call without args', () => {
    expectTypeOf(fnWithOptionalInput()).toEqualTypeOf<Promise<number>>()
    // @ts-expect-error - input is required
    expectTypeOf(fn()).toEqualTypeOf<Promise<number>>()
  })

  describe('context', () => {
    it('can accept context', () => {
      const client = {} as ProcedureClient<{ val: string }, { val: number }, { userId: string }>

      client({ val: '123' }, { context: { userId: '123' } })
      // @ts-expect-error - invalid context
      client({ val: '123' }, { context: { userId: 123 } })
      // @ts-expect-error - context is required
      client({ val: '123' })
    })

    it('optional options when context is optional', () => {
      const client = {} as ProcedureClient<{ val: string }, { val: number }, undefined | { userId: string }>

      client({ val: '123' })
      client({ val: '123' }, { context: { userId: '123' } })
    })

    it('can call without args when both input and context are optional', () => {
      const client = {} as ProcedureClient<undefined | { val: string }, { val: number }, undefined | { userId: string }>

      client()
      client({ val: 'string' }, { context: { userId: '123' } })
      // @ts-expect-error - input is invalid
      client({ val: 123 }, { context: { userId: '123' } })
      // @ts-expect-error - context is invalid
      client({ val: '123' }, { context: { userId: 123 } })
    })
  })
})

describe('createProcedureClient', () => {
  const schema = z.object({ val: z.string().transform(v => Number(v)) })
  const procedure = {} as Procedure<WELL_CONTEXT, { val: string }, typeof schema, typeof schema, { val: string }>
  const procedureWithContext = {} as Procedure<{ userId?: string }, { db: string }, typeof schema, typeof schema, { val: string }>

  it('just a client', () => {
    const client = createProcedureClient({
      procedure,
    })

    expectTypeOf(client).toEqualTypeOf<ProcedureClient<{ val: string }, { val: number }, unknown>>()
  })

  it('context can be optional and can be a sync or async function', () => {
    createProcedureClient({
      procedure,
    })

    createProcedureClient({
      procedure,
      context: undefined,
    })

    // @ts-expect-error - missing context
    createProcedureClient({
      procedure: procedureWithContext,
    })

    createProcedureClient({
      procedure: procedureWithContext,
      context: { userId: '123' },
    })

    createProcedureClient({
      procedure: procedureWithContext,
      // @ts-expect-error invalid context
      context: { userId: 123 },
    })

    createProcedureClient({
      procedure: procedureWithContext,
      context: () => ({ userId: '123' }),
    })

    createProcedureClient({
      procedure: procedureWithContext,
      // @ts-expect-error invalid context
      context: () => ({ userId: 123 }),
    })

    createProcedureClient({
      procedure: procedureWithContext,
      context: async () => ({ userId: '123' }),
    })

    createProcedureClient({
      procedure: procedureWithContext,
      // @ts-expect-error invalid context
      context: async () => ({ userId: 123 }),
    })
  })

  it('accept hooks', () => {
    createProcedureClient({
      procedure,

      async interceptor(input, context, meta) {
        expectTypeOf(input).toEqualTypeOf<unknown>()
        expectTypeOf(context).toEqualTypeOf<WELL_CONTEXT>()
        expectTypeOf(meta).toEqualTypeOf<Meta & { next: () => Promise<{ val: number }> }>()

        return { val: 123 }
      },

      onStart(state, context, meta) {
        expectTypeOf(state).toEqualTypeOf<{ status: 'pending', input: unknown, output: undefined, error: undefined }>()
        expectTypeOf(context).toEqualTypeOf<WELL_CONTEXT>()
        expectTypeOf(meta).toEqualTypeOf<Meta>()
      },

      onSuccess(state, context, meta) {
        expectTypeOf(state).toEqualTypeOf<{ status: 'success', input: unknown, output: { val: number }, error: undefined }>()
        expectTypeOf(context).toEqualTypeOf<WELL_CONTEXT>()
        expectTypeOf(meta).toEqualTypeOf<Meta>()
      },

      onError(state, context, meta) {
        expectTypeOf(state).toEqualTypeOf<{ status: 'error', input: unknown, output: undefined, error: Error }>()
        expectTypeOf(context).toEqualTypeOf<WELL_CONTEXT>()
        expectTypeOf(meta).toEqualTypeOf<Meta>()
      },

      onFinish(state, context, meta) {
        expectTypeOf(state).toEqualTypeOf<{ status: 'success', input: unknown, output: { val: number }, error: undefined } | { status: 'error', input: unknown, output: undefined, error: Error }>()
        expectTypeOf(context).toEqualTypeOf<WELL_CONTEXT>()
        expectTypeOf(meta).toEqualTypeOf<Meta>()
      },
    })
  })

  it('accept paths', () => {
    createProcedureClient({
      procedure,
      path: ['users'],
    })

    createProcedureClient({
      procedure,
      // @ts-expect-error - invalid path
      path: [123],
    })
  })
})

it('support lazy procedure', () => {
  const schema = z.object({ val: z.string().transform(v => Number(v)) })
  const procedure = {} as Procedure<{ userId?: string }, undefined, typeof schema, typeof schema, { val: string }>
  const lazied = lazy(() => Promise.resolve({ default: procedure }))

  const client = createProcedureClient({
    procedure: lazied,
    context: async () => ({ userId: 'string' }),
    path: ['users'],

    onSuccess(state, context, meta) {
      expectTypeOf(state).toEqualTypeOf<{ status: 'success', input: unknown, output: { val: number }, error: undefined }>()
      expectTypeOf(context).toEqualTypeOf<{ userId: string }>()
      expectTypeOf(meta).toEqualTypeOf<Meta>()
    },
  })

  expectTypeOf(client).toEqualTypeOf<ProcedureClient<{ val: string }, { val: number }, unknown>>()
})
