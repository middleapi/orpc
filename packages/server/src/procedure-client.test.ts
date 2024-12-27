import type { WELL_CONTEXT } from './types'
import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { isLazy, lazy, unlazy } from './lazy'
import { Procedure } from './procedure'
import { createProcedureClient } from './procedure-client'

const schema = z.object({ val: z.string().transform(v => Number(v)) })

const handler = vi.fn(() => ({ val: '123' }))
const mid1 = vi.fn((_, __, meta) => meta.next({}))
const mid2 = vi.fn((_, __, meta) => meta.next({}))

const procedure = new Procedure<WELL_CONTEXT, undefined, typeof schema, typeof schema, { val: string }>({
  contract: new ContractProcedure({
    InputSchema: schema,
    OutputSchema: schema,
  }),
  handler,
  middlewares: [mid1, mid2],
})

const procedureCases = [
  ['without lazy', procedure],
  ['with lazy', lazy(() => Promise.resolve({ default: procedure }))],
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(procedureCases)('createProcedureClient - case %s', async (_, procedure) => {
  const unwrappedProcedure = isLazy(procedure) ? (await unlazy(procedure)).default : procedure

  it('just a client', async () => {
    const client = createProcedureClient({
      procedure,
    })

    await expect(client({ val: '123' })).resolves.toEqual({ val: 123 })

    expect(handler).toBeCalledTimes(1)
    expect(handler).toBeCalledWith({ val: 123 }, undefined, { path: [], procedure: unwrappedProcedure })

    expect(mid1).toBeCalledTimes(1)
    expect(mid1).toBeCalledWith({ val: 123 }, undefined, { path: [], procedure: unwrappedProcedure, next: expect.any(Function), output: expect.any(Function) })

    expect(mid2).toBeCalledTimes(1)
    expect(mid2).toBeCalledWith({ val: 123 }, undefined, { path: [], procedure: unwrappedProcedure, next: expect.any(Function), output: expect.any(Function) })
  })

  it('validate input and output', () => {
    const client = createProcedureClient({
      procedure,
    })

    // @ts-expect-error - invalid input
    expect(client({ val: 123 })).rejects.toThrow('Input validation failed')

    // @ts-expect-error - invalid output
    handler.mockReturnValueOnce({ val: 1234 })
    expect(client({ val: '1234' })).rejects.toThrow('Output validation failed')
  })

  it('middleware can return output directly', async () => {
    const client = createProcedureClient({
      procedure,
    })

    mid1.mockReturnValueOnce({ output: { val: '990' } })

    await expect(client({ val: '123' })).resolves.toEqual({ val: 990 })

    expect(mid1).toBeCalledTimes(1)
    expect(mid2).toBeCalledTimes(0)
    expect(handler).toBeCalledTimes(0)

    vi.clearAllMocks()

    mid2.mockReturnValueOnce({ output: { val: '9900' } })

    await expect(client({ val: '123' })).resolves.toEqual({ val: 9900 })

    expect(mid1).toBeCalledTimes(1)
    expect(mid2).toBeCalledTimes(1)
    expect(handler).toBeCalledTimes(0)

    expect(mid1).toReturnWith(Promise.resolve({ output: { val: '9900' }, context: undefined }))
  })

  it('output from middleware still be validated', async () => {
    const client = createProcedureClient({
      procedure,
      context: { userId: '123' },
    })

    mid1.mockReturnValueOnce({ output: { val: 990 } })
    await expect(client({ val: '1234' })).rejects.toThrow('Output validation failed')

    vi.clearAllMocks()

    mid2.mockReturnValueOnce({ output: { val: 9900 } })
    await expect(client({ val: '1234' })).rejects.toThrow('Output validation failed')
  })

  it('middleware can add extra context - single', async () => {
    const client = createProcedureClient({
      procedure,
    })

    mid1.mockImplementationOnce((input, context, meta) => {
      return meta.next({
        context: {
          extra1: '__extra1__',
        },
      })
    })

    mid2.mockImplementationOnce((input, context, meta) => {
      return meta.next({
        context: {
          extra2: '__extra2__',
        },
      })
    })

    await expect(client({ val: '123' })).resolves.toEqual({ val: 123 })

    expect(mid1).toBeCalledTimes(1)
    expect(mid1).toHaveBeenCalledWith(expect.any(Object), undefined, expect.any(Object))

    expect(mid2).toBeCalledTimes(1)
    expect(mid2).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ extra1: '__extra1__' }), expect.any(Object))

    expect(handler).toBeCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.any(Object), { extra1: '__extra1__', extra2: '__extra2__' }, expect.any(Object))
  })

  it('middleware can override context', async () => {
    const client = createProcedureClient({
      procedure,
      context: { userId: '123' },
    })

    mid1.mockImplementationOnce((input, context, meta) => {
      return meta.next({
        context: {
          userId: '__override1__',
        },
      })
    })

    mid2.mockImplementationOnce((input, context, meta) => {
      return meta.next({
        context: {
          userId: '__override2__',
        },
      })
    })

    await expect(client({ val: '123' })).resolves.toEqual({ val: 123 })

    expect(mid1).toBeCalledTimes(1)
    expect(mid1).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userId: '123' }), expect.any(Object))

    expect(mid2).toBeCalledTimes(1)
    expect(mid2).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userId: '__override1__' }), expect.any(Object))

    expect(handler).toBeCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userId: '__override2__' }), expect.any(Object))
  })

  const contextCases = [
    ['directly value', { val: '__val__' }],
    ['sync function value', () => ({ val: '__val__' })],
    ['async function value', async () => ({ val: '__val__' })],
  ] as const

  it.each(contextCases)('can accept context: %s', async (_, context) => {
    const client = createProcedureClient({
      procedure,
      context,
    })

    await client({ val: '123' })

    expect(mid1).toBeCalledTimes(1)
    expect(mid1).toBeCalledWith(expect.any(Object), { val: '__val__' }, expect.any(Object))

    expect(mid2).toBeCalledTimes(1)
    expect(mid2).toBeCalledWith(expect.any(Object), { val: '__val__' }, expect.any(Object))

    expect(handler).toBeCalledTimes(1)
    expect(handler).toBeCalledWith(expect.any(Object), { val: '__val__' }, expect.any(Object))
  })

  it.each(contextCases)('can accept hooks - context: %s', async (_, context) => {
    const execute = vi.fn((input, context, meta) => meta.next())
    const onStart = vi.fn()
    const onSuccess = vi.fn()
    const onError = vi.fn()
    const onFinish = vi.fn()

    const client = createProcedureClient({
      procedure,
      context,
      path: ['users'],
      execute,
      onStart,
      onSuccess,
      onError,
      onFinish,
    })

    await client({ val: '123' })

    const meta = {
      path: ['users'],
      procedure: unwrappedProcedure,
    }

    const contextValue = { val: '__val__' }

    expect(execute).toBeCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({ val: '123' }, contextValue, {
      ...meta,
      next: expect.any(Function),
    })

    expect(onStart).toBeCalledTimes(1)
    expect(onStart).toHaveBeenCalledWith(
      { status: 'pending', input: { val: '123' }, output: undefined, error: undefined },
      contextValue,
      meta,
    )

    expect(onSuccess).toBeCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(
      { status: 'success', input: { val: '123' }, output: { val: 123 }, error: undefined },
      contextValue,
      meta,
    )

    expect(onError).toBeCalledTimes(0)
  })

  it('accept paths', async () => {
    const onSuccess = vi.fn()
    const client = createProcedureClient({
      procedure,
      path: ['users'],
      onSuccess,
    })

    await client({ val: '123' })

    expect(mid1).toBeCalledTimes(1)
    expect(mid1).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({ path: ['users'] }))

    expect(mid2).toBeCalledTimes(1)
    expect(mid2).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({ path: ['users'] }))

    expect(handler).toBeCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({ path: ['users'] }))

    expect(onSuccess).toBeCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({ path: ['users'] }))
  })

  it('support signal', async () => {
    const controller = new AbortController()
    const signal = controller.signal

    const onSuccess = vi.fn()

    const client = createProcedureClient({
      procedure,
      onSuccess,
      context: { userId: '123' },
    })

    await client({ val: '123' }, { signal })

    expect(mid1).toBeCalledTimes(1)
    expect(mid1).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ signal }))

    expect(mid2).toBeCalledTimes(1)
    expect(mid2).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ signal }))

    expect(handler).toBeCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ signal }))

    expect(onSuccess).toBeCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ signal }))
  })
})

it('still work without middleware', async () => {
  const procedure = new Procedure({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    handler,
  })

  const client = createProcedureClient({
    procedure,
  })

  await expect(client({ val: '123' })).resolves.toEqual({ val: 123 })

  expect(handler).toBeCalledTimes(1)
  expect(handler).toHaveBeenCalledWith({ val: 123 }, undefined, { path: [], procedure })
})

it('still work without InputSchema', async () => {
  const procedure = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: schema,
    }),
    handler,
  })

  const client = createProcedureClient({
    procedure,
  })

  await expect(client('anything')).resolves.toEqual({ val: 123 })

  expect(handler).toBeCalledTimes(1)
  expect(handler).toHaveBeenCalledWith('anything', undefined, { path: [], procedure })
})

it('still work without OutputSchema', async () => {
  const procedure = new Procedure({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: undefined,
    }),
    handler,
  })

  const client = createProcedureClient({
    procedure,
  })

  // @ts-expect-error - without output schema
  handler.mockReturnValueOnce('anything')

  await expect(client({ val: '123' })).resolves.toEqual('anything')

  expect(handler).toBeCalledTimes(1)
  expect(handler).toHaveBeenCalledWith({ val: 123 }, undefined, { path: [], procedure })
})

it('has helper `output` in meta', async () => {
  const client = createProcedureClient({
    procedure,
  })

  mid2.mockImplementationOnce((input, context, meta) => {
    return meta.output({ val: '99990' })
  })

  await expect(client({ val: '123' })).resolves.toEqual({ val: 99990 })

  expect(mid1).toBeCalledTimes(1)
  expect(mid2).toBeCalledTimes(1)
  expect(handler).toBeCalledTimes(0)

  expect(mid1).toReturnWith(Promise.resolve({ output: { val: '99990' }, context: undefined }))
})
