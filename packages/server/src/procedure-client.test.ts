import type { ErrorMap } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import * as ClientModule from '@orpc/client'
import * as ContractModule from '@orpc/contract'
import * as SharedV2Module from '@orpc/shared'
import z from 'zod'
import { os } from './builder'
import * as ErrorModule from './error'
import { createProcedureClient } from './procedure-client'

const isAsyncIteratorObject = SharedV2Module.isAsyncIteratorObject
const ValidationError = ContractModule.ValidationError
const createORPCErrorConstructorMapSpy = vi.spyOn(ErrorModule, 'createORPCErrorConstructorMap')
const reconcileErrorSpy = vi.spyOn(ContractModule, 'reconcileORPCError')
const cloneORPCErrorSpy = vi.spyOn(ClientModule, 'cloneORPCError')
const overrideSpy = vi.spyOn(SharedV2Module, 'override')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createProcedureClient', () => {
  const handler = vi.fn(async () => '__OUTPUT__')
  const mid1 = vi.fn(({ next }, input, done) => next())
  const mid2 = vi.fn(({ next }, input, done) => next())
  const interceptor = vi.fn(({ next }) => next())
  const procedure = os.use(mid1).use(mid2).handler(handler)
  const client = createProcedureClient(procedure, { interceptors: [interceptor] })

  it('workflow is correct', async () => {
    await expect(client()).resolves.toBe('__OUTPUT__')

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveResolvedWith('__OUTPUT__')

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid1).toHaveBeenCalledAfter(interceptor)
    expect(mid1).toHaveResolvedWith({ context: {}, output: '__OUTPUT__' })

    expect(mid2).toHaveBeenCalledTimes(1)
    expect(mid2).toHaveBeenCalledAfter(mid1)
    expect(mid2).toHaveResolvedWith({ context: {}, output: '__OUTPUT__' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledAfter(mid2)
    expect(handler).toHaveResolvedWith('__OUTPUT__')
  })

  it('handler throw error', async () => {
    const error = new Error('__ERROR__')
    handler.mockRejectedValueOnce(error)

    await expect(client('INPUT' as any)).rejects.toBe(error)

    expect(interceptor).toHaveBeenCalledTimes(1)
    await expect(interceptor.mock.results[0]!.value).rejects.toThrow(error)

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid1).toHaveBeenCalledAfter(interceptor)
    await expect(mid1.mock.results[0]!.value).rejects.toThrow(error)

    expect(mid2).toHaveBeenCalledTimes(1)
    expect(mid2).toHaveBeenCalledAfter(mid1)
    await expect(mid2.mock.results[0]!.value).rejects.toThrow(error)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledAfter(mid2)
  })

  it('middleware throw error', async () => {
    const error = new Error('__MIDDLEWARE_ERROR__')
    mid2.mockRejectedValueOnce(error)

    await expect(client('INPUT' as any)).rejects.toThrow(error)

    expect(interceptor).toHaveBeenCalledTimes(1)
    await expect(interceptor.mock.results[0]!.value).rejects.toThrow(error)

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid1).toHaveBeenCalledAfter(interceptor)
    await expect(mid1.mock.results[0]!.value).rejects.toThrow(error)

    expect(mid2).toHaveBeenCalledTimes(1)
    expect(mid2).toHaveBeenCalledAfter(mid1)

    expect(handler).not.toHaveBeenCalled()
  })

  it('interceptor throw error', async () => {
    const error = new Error('__INTERCEPTOR_ERROR__')
    interceptor.mockRejectedValueOnce(error)

    await expect(client('INPUT' as any)).rejects.toThrow(error)

    expect(interceptor).toHaveBeenCalledTimes(1)

    expect(mid1).not.toHaveBeenCalled()
    expect(mid2).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('with context, procedure, path, errors, input, signal, lastEventId', async () => {
    const signal = new AbortController().signal
    const errorMap = {
      UNAUTHENTICATED: { message: '__UNAUTHENTICATED__' },
    }

    const procedure = os.input(z.any()).errors(errorMap).use(mid1).use(mid2).handler(handler)
    const client = createProcedureClient(procedure, {
      interceptors: [interceptor],
      context: { auth: true },
      path: ['__PATH__'],
    })

    await expect(client('INPUT', { signal, lastEventId: '__LAST_EVENT_ID__' })).resolves.toBe('__OUTPUT__')

    expect(createORPCErrorConstructorMapSpy).toHaveBeenCalledTimes(1)
    expect(createORPCErrorConstructorMapSpy).toHaveBeenCalledWith(errorMap)

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { auth: true },
        path: ['__PATH__'],
        input: 'INPUT',
        signal,
        lastEventId: '__LAST_EVENT_ID__',
        procedure: expect.toBeOneOf([procedure]),
        errors: expect.toBeOneOf([createORPCErrorConstructorMapSpy.mock.results[0]!.value]),
      }),
    )

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid1).toHaveBeenCalledAfter(interceptor)
    expect(mid1).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { auth: true },
        path: ['__PATH__'],
        signal,
        lastEventId: '__LAST_EVENT_ID__',
        procedure: expect.toBeOneOf([procedure]),
        errors: expect.toBeOneOf([createORPCErrorConstructorMapSpy.mock.results[0]!.value]),
      }),
      'INPUT',
      expect.any(Function),
    )

    expect(mid2).toHaveBeenCalledTimes(1)
    expect(mid2).toHaveBeenCalledAfter(mid1)
    expect(mid2).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { auth: true },
        path: ['__PATH__'],
        signal,
        lastEventId: '__LAST_EVENT_ID__',
        procedure: expect.toBeOneOf([procedure]),
        errors: expect.toBeOneOf([createORPCErrorConstructorMapSpy.mock.results[0]!.value]),
      }),
      'INPUT',
      expect.any(Function),
    )

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledAfter(mid2)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { auth: true },
        path: ['__PATH__'],
        signal,
        lastEventId: '__LAST_EVENT_ID__',
        input: 'INPUT',
        procedure: expect.toBeOneOf([procedure]),
        errors: expect.toBeOneOf([createORPCErrorConstructorMapSpy.mock.results[0]!.value]),
      }),
      'INPUT',
    )
  })

  it('interceptor can change input/output/signal/procedure', async () => {
    const signal = new AbortController().signal

    const overrideSignal = new AbortController().signal
    const overridedHandler = vi.fn(() => '__OVERRIDED_OUTPUT__')
    const overridedProcedure = os.use(mid1).handler(overridedHandler)
    interceptor.mockImplementationOnce(async ({ next }) => {
      const output = await next({
        input: '__OVERRIDED_INPUT__',
        signal: overrideSignal,
        procedure: overridedProcedure,
        context: { auth: '__OVERRIDED_CONTEXT__' },
        path: ['__OVERRIDED_PATH__'],
        lastEventId: '__OVERRIDED_LAST_EVENT_ID__',
      })

      return `OVERRIDED__${output}`
    })

    await expect(client('INPUT' as any, { signal, lastEventId: '__LAST_EVENT_ID__' })).resolves.toBe('OVERRIDED____OVERRIDED_OUTPUT__')

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {},
        path: [],
        signal,
        lastEventId: '__LAST_EVENT_ID__',
        procedure: expect.toBeOneOf([procedure]),
        input: 'INPUT',
      }),
    )

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid1).toHaveBeenCalledAfter(interceptor)
    expect(mid1).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: overrideSignal,
        procedure: overridedProcedure,
        context: { auth: '__OVERRIDED_CONTEXT__' },
        path: ['__OVERRIDED_PATH__'],
        lastEventId: '__OVERRIDED_LAST_EVENT_ID__',
      }),
      '__OVERRIDED_INPUT__',
      expect.any(Function),
    )

    // mid2 and handler are not called because overridedProcedure does not use them
    expect(mid2).toHaveBeenCalledTimes(0)
    expect(handler).toHaveBeenCalledTimes(0)

    expect(overridedHandler).toHaveBeenCalledTimes(1)
    expect(overridedHandler).toHaveBeenCalledAfter(mid1)
    expect(overridedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { auth: '__OVERRIDED_CONTEXT__' },
        path: ['__OVERRIDED_PATH__'],
        signal: overrideSignal,
        lastEventId: '__OVERRIDED_LAST_EVENT_ID__',
      }),
      '__OVERRIDED_INPUT__',
    )
  })

  it('middleware can override/extend context/output', async () => {
    const client = createProcedureClient(procedure, {
      context: { i1: 'i', i2: 'i' },
      interceptors: [interceptor],
    })

    mid1.mockImplementationOnce(async ({ next }, input, done) => {
      const result = await next({
        context: { i1: 'mid1', mid11: 'mid1', mid12: 'mid1' },
      })

      return {
        ...result,
        output: `MID1__${result.output}`,
      }
    })

    mid2.mockImplementationOnce(async ({ next }, input, done) => {
      const result = await next({
        context: { mid11: 'mid2', mid21: 'mid2', mid22: 'mid2' },
      })

      return {
        ...result,
        output: `MID2__${result.output}`,
      }
    })

    await expect(client()).resolves.toBe('MID1__MID2____OUTPUT__')

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid1).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { i1: 'i', i2: 'i' },
      }),
      undefined,
      expect.any(Function),
    )
    expect(mid1).toHaveNthResolvedWith(1, { output: 'MID1__MID2____OUTPUT__', context: { i1: 'mid1', i2: 'i', mid12: 'mid1', mid11: 'mid2', mid21: 'mid2', mid22: 'mid2' } })

    expect(mid2).toHaveBeenCalledTimes(1)
    expect(mid2).toHaveBeenCalledAfter(mid1)
    expect(mid2).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { i1: 'mid1', i2: 'i', mid11: 'mid1', mid12: 'mid1' },
      }),
      undefined,
      expect.any(Function),
    )
    expect(mid2).toHaveNthResolvedWith(1, { output: 'MID2____OUTPUT__', context: { i1: 'mid1', i2: 'i', mid12: 'mid1', mid11: 'mid2', mid21: 'mid2', mid22: 'mid2' } })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledAfter(mid2)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { i1: 'mid1', i2: 'i', mid12: 'mid1', mid11: 'mid2', mid21: 'mid2', mid22: 'mid2' },
      }),
      undefined,
    )
  })

  it('middleware can early return with done helper', async () => {
    mid1.mockImplementationOnce((options, input, done) => done({ output: 'MID1__EARLY_RETURN__' }))

    await expect(client()).resolves.toBe('MID1__EARLY_RETURN__')

    expect(interceptor).toHaveBeenCalledTimes(1)
    await expect(interceptor.mock.results[0]!.value).resolves.toBe('MID1__EARLY_RETURN__')

    expect(mid1).toHaveBeenCalledTimes(1)
    expect(mid2).toHaveBeenCalledTimes(0)
    expect(handler).toHaveBeenCalledTimes(0)
  })

  describe('with multiple standard schemas', () => {
    it('success - input and output schemas that transform during validation', async () => {
      const inputSchema1 = z.string().transform(value => `inputSchema1__${value}`)
      const inputSchema2 = z.string().transform(value => `inputSchema2__${value}`)
      const inputSchema3 = z.string().transform(value => `inputSchema3__${value}`)
      const outputSchema1 = z.string().transform(value => `outputSchema1__${value}`)
      const outputSchema2 = z.string().transform(value => `outputSchema2__${value}`)
      const outputSchema3 = z.string().transform(value => `outputSchema3__${value}`)

      const mid3 = vi.fn(({ next }) => next())

      const procedure = os
        .input(inputSchema1)
        .output(outputSchema1)
        .use(mid1)
        .input(inputSchema2)
        .output(outputSchema2)
        .use(mid2)
        .input(inputSchema3)
        .output(outputSchema3)
        .use(mid3)
        .handler(handler)

      const client = createProcedureClient(procedure, { interceptors: [interceptor] })

      await expect(client('INPUT')).resolves.toBe('outputSchema1__outputSchema2__outputSchema3____OUTPUT__')

      expect(interceptor).toHaveBeenCalledTimes(1)
      expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({ input: 'INPUT' }))
      expect(interceptor).toHaveResolvedWith('outputSchema1__outputSchema2__outputSchema3____OUTPUT__')

      expect(mid1).toHaveBeenCalledTimes(1)
      expect(mid1).toHaveBeenCalledAfter(interceptor)
      expect(mid1).toHaveBeenCalledWith(
        expect.objectContaining({ }),
        'inputSchema1__INPUT',
        expect.any(Function),
      )
      expect(mid1).toHaveResolvedWith(
        expect.objectContaining({ output: 'outputSchema2__outputSchema3____OUTPUT__' }),
      )

      expect(mid2).toHaveBeenCalledTimes(1)
      expect(mid2).toHaveBeenCalledAfter(mid1)
      expect(mid2).toHaveBeenCalledWith(
        expect.objectContaining({ }),
        'inputSchema2__inputSchema1__INPUT',
        expect.any(Function),
      )
      expect(mid2).toHaveResolvedWith(
        expect.objectContaining({ output: 'outputSchema3____OUTPUT__' }),
      )

      expect(mid3).toHaveBeenCalledTimes(1)
      expect(mid3).toHaveBeenCalledAfter(mid2)
      expect(mid3).toHaveBeenCalledWith(
        expect.objectContaining({}),
        'inputSchema3__inputSchema2__inputSchema1__INPUT',
        expect.any(Function),
      )
      expect(mid3).toHaveResolvedWith(
        expect.objectContaining({ output: '__OUTPUT__' }),
      )

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledAfter(mid3)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({}),
        'inputSchema3__inputSchema2__inputSchema1__INPUT',
      )
    })

    describe('failed', async () => {
      const inputSchema1 = z.looseObject({ inputSchema1: z.number() })
      const inputSchema2 = z.looseObject({ inputSchema2: z.number() })
      const inputSchema3 = z.looseObject({ inputSchema3: z.number() })
      const outputSchema1 = z.looseObject({ outputSchema1: z.number() })
      const outputSchema2 = z.looseObject({ outputSchema2: z.number() })
      const outputSchema3 = z.looseObject({ outputSchema3: z.number() })

      const inputSchema1ValidationSpy = vi.spyOn(inputSchema1['~standard'], 'validate')
      const inputSchema2ValidationSpy = vi.spyOn(inputSchema2['~standard'], 'validate')
      const inputSchema3ValidationSpy = vi.spyOn(inputSchema3['~standard'], 'validate')
      const outputSchema1ValidationSpy = vi.spyOn(outputSchema1['~standard'], 'validate')
      const outputSchema2ValidationSpy = vi.spyOn(outputSchema2['~standard'], 'validate')
      const outputSchema3ValidationSpy = vi.spyOn(outputSchema3['~standard'], 'validate')

      const mid3 = vi.fn(({ next }) => next())
      const handler = vi.fn(() => ({ outputSchema1: 1, outputSchema2: 2, outputSchema3: 3 }))

      const procedure = os
        .input(inputSchema1)
        .output(outputSchema1)
        .use(mid1)
        .input(inputSchema2)
        .output(outputSchema2)
        .use(mid2)
        .input(inputSchema3)
        .output(outputSchema3)
        .use(mid3)
        .handler(handler)

      const client = createProcedureClient(procedure, { interceptors: [interceptor] })

      it('inputSchema1', async () => {
        const invalidInput: any = { inputSchema1: 'INVALID', inputSchema2: 2, inputSchema3: 3 }
        await expect(client(invalidInput)).rejects.toSatisfy((error) => {
          expect(inputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema2ValidationSpy).toHaveBeenCalledTimes(0)
          expect(inputSchema3ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema1ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema2ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema3ValidationSpy).toHaveBeenCalledTimes(0)

          expect(error).toBeInstanceOf(ORPCError)
          expect(error.code).toEqual('BAD_REQUEST')
          expect(error.cause).toBeInstanceOf(ValidationError)
          expect(error.cause.issues).toBe(inputSchema1ValidationSpy.mock.results[0]!.value.issues)
          expect(error.cause.invalidData).toEqual(invalidInput)

          return true
        })

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid1).toHaveBeenCalledTimes(0)
        expect(mid2).toHaveBeenCalledTimes(0)
        expect(mid3).toHaveBeenCalledTimes(0)
        expect(handler).toHaveBeenCalledTimes(0)
      })

      it('inputSchema2', async () => {
        const invalidInput: any = { inputSchema1: 1, inputSchema2: 'INVALID', inputSchema3: 3 }
        await expect(client(invalidInput)).rejects.toSatisfy((error) => {
          expect(inputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema3ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema1ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema2ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema3ValidationSpy).toHaveBeenCalledTimes(0)

          expect(error).toBeInstanceOf(ORPCError)
          expect(error.code).toEqual('BAD_REQUEST')
          expect(error.cause).toBeInstanceOf(ValidationError)
          expect(error.cause.issues).toBe(inputSchema2ValidationSpy.mock.results[0]!.value.issues)
          expect(error.cause.invalidData).toEqual(invalidInput)

          return true
        })

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid2).toHaveBeenCalledTimes(0)
        expect(mid3).toHaveBeenCalledTimes(0)
        expect(handler).toHaveBeenCalledTimes(0)
      })

      it('inputSchema3', async () => {
        const invalidInput: any = { inputSchema1: 1, inputSchema2: 2, inputSchema3: 'INVALID' }
        await expect(client(invalidInput)).rejects.toSatisfy((error) => {
          expect(inputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema3ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema1ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema2ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema3ValidationSpy).toHaveBeenCalledTimes(0)

          expect(error).toBeInstanceOf(ORPCError)
          expect(error.code).toEqual('BAD_REQUEST')
          expect(error.cause).toBeInstanceOf(ValidationError)
          expect(error.cause.issues).toBe(inputSchema3ValidationSpy.mock.results[0]!.value.issues)
          expect(error.cause.invalidData).toEqual(invalidInput)

          return true
        })

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid2).toHaveBeenCalledTimes(1)
        await expect(mid2.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid3).toHaveBeenCalledTimes(0)
        expect(handler).toHaveBeenCalledTimes(0)
      })

      it('outputSchema1', async () => {
        const invalidOutput: any = { outputSchema1: 'INVALID', outputSchema2: 2, outputSchema3: 3 }
        handler.mockResolvedValueOnce(invalidOutput)

        await expect(client({ inputSchema1: 1, inputSchema2: 2, inputSchema3: 3 })).rejects.toSatisfy((error) => {
          expect(inputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema3ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema3ValidationSpy).toHaveBeenCalledTimes(1)

          expect(error).toBeInstanceOf(ORPCError)
          expect(error.code).toEqual('INTERNAL_SERVER_ERROR')
          expect(error.cause).toBeInstanceOf(ValidationError)
          expect(error.cause.issues).toBe(outputSchema1ValidationSpy.mock.results[0]!.value.issues)
          expect(error.cause.invalidData).toEqual(invalidOutput)

          return true
        })

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid1).toHaveBeenCalledTimes(1)
        expect(mid1).toHaveResolvedWith(expect.objectContaining({ output: invalidOutput }))
        expect(mid2).toHaveBeenCalledTimes(1)
        expect(mid2).toHaveResolvedWith(expect.objectContaining({ output: invalidOutput }))
        expect(mid3).toHaveBeenCalledTimes(1)
        expect(mid3).toHaveResolvedWith(expect.objectContaining({ output: invalidOutput }))
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveResolvedWith(invalidOutput)
      })

      it('outputSchema2', async () => {
        const invalidOutput: any = { outputSchema1: 1, outputSchema2: 'INVALID', outputSchema3: 3 }
        handler.mockResolvedValueOnce(invalidOutput)

        await expect(client({ inputSchema1: 1, inputSchema2: 2, inputSchema3: 3 })).rejects.toSatisfy((error) => {
          expect(inputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema3ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema1ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema3ValidationSpy).toHaveBeenCalledTimes(1)

          expect(error).toBeInstanceOf(ORPCError)
          expect(error.code).toEqual('INTERNAL_SERVER_ERROR')
          expect(error.cause).toBeInstanceOf(ValidationError)
          expect(error.cause.issues).toBe(outputSchema2ValidationSpy.mock.results[0]!.value.issues)
          expect(error.cause.invalidData).toEqual(invalidOutput)

          return true
        })

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid2).toHaveBeenCalledTimes(1)
        expect(mid2).toHaveResolvedWith(expect.objectContaining({ output: invalidOutput }))
        expect(mid3).toHaveBeenCalledTimes(1)
        expect(mid3).toHaveResolvedWith(expect.objectContaining({ output: invalidOutput }))
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveResolvedWith(invalidOutput)
      })

      it('outputSchema3', async () => {
        const invalidOutput: any = { outputSchema1: 1, outputSchema2: 2, outputSchema3: 'INVALID' }
        handler.mockResolvedValueOnce(invalidOutput)

        await expect(client({ inputSchema1: 1, inputSchema2: 2, inputSchema3: 3 })).rejects.toSatisfy((error) => {
          expect(inputSchema1ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema2ValidationSpy).toHaveBeenCalledTimes(1)
          expect(inputSchema3ValidationSpy).toHaveBeenCalledTimes(1)
          expect(outputSchema1ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema2ValidationSpy).toHaveBeenCalledTimes(0)
          expect(outputSchema3ValidationSpy).toHaveBeenCalledTimes(1)

          expect(error).toBeInstanceOf(ORPCError)
          expect(error.code).toEqual('INTERNAL_SERVER_ERROR')
          expect(error.cause).toBeInstanceOf(ValidationError)
          expect(error.cause.issues).toBe(outputSchema3ValidationSpy.mock.results[0]!.value.issues)
          expect(error.cause.invalidData).toEqual(invalidOutput)

          return true
        })

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid2).toHaveBeenCalledTimes(1)
        await expect(mid2.mock.results[0]!.value).rejects.toThrow(ORPCError)
        expect(mid3).toHaveBeenCalledTimes(1)
        expect(mid3).toHaveResolvedWith(expect.objectContaining({ output: invalidOutput }))
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveResolvedWith(invalidOutput)
      })
    })
  })

  it('next method can be called multiple times (with transforming schemas)', async () => {
    const inputSchema = z.string().transform(v => `inputSchema__${v}`)
    const outputSchema = z.string().transform(v => `outputSchema__${v}`)

    const inputSchemaValidateSpy = vi.spyOn(inputSchema['~standard'], 'validate')
    const outputSchemaValidateSpy = vi.spyOn(outputSchema['~standard'], 'validate')

    interceptor.mockImplementationOnce(
      options => Promise.all([
        options.next({ ...options, context: { auth: 1 } }),
        options.next({ ...options, context: { auth: 2 } }),
      ]).then(([_1, _2]) => _2),
    )

    mid1
      .mockImplementationOnce(({ next }) => next({ context: { auth: 3 } }))
      .mockImplementationOnce(({ next }) => Promise.all([
        next({ context: { auth: 4 } }),
        next({ context: { auth: 5 } }),
      ]).then(([_1, _2]) => _2))

    mid2
      .mockImplementationOnce(({ next }) => next({ context: { auth: 6 } }))
      .mockImplementationOnce(({ next }) => next({ context: { auth: 7 } }))
      .mockImplementationOnce(({ next }) => Promise.all([
        next({ context: { auth: 8 } }),
        next({ context: { auth: 9 } }),
      ]).then(([_1, _2]) => _2))

    handler
      .mockResolvedValueOnce('__1__')
      .mockResolvedValueOnce('__2__')
      .mockResolvedValueOnce('__3__')
      .mockResolvedValueOnce('__4__')

    const procedure = os.use(mid1).input(inputSchema).output(outputSchema).use(mid2).handler(handler)

    const client = createProcedureClient(procedure, { interceptors: [interceptor] })

    await expect(client('INPUT')).resolves.toBe('outputSchema____4__')

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveNthResolvedWith(1, 'outputSchema____4__')

    expect(mid1).toHaveBeenCalledTimes(2)
    expect(mid1).toHaveBeenNthCalledWith(1, expect.objectContaining({ context: { auth: 1 } }), 'INPUT', expect.any(Function))
    expect(mid1).toHaveNthResolvedWith(1, expect.objectContaining({ output: 'outputSchema____1__' }))
    expect(mid1).toHaveBeenNthCalledWith(2, expect.objectContaining({ context: { auth: 2 } }), 'INPUT', expect.any(Function))
    expect(mid1).toHaveNthResolvedWith(2, expect.objectContaining({ output: 'outputSchema____4__' }))

    expect(inputSchemaValidateSpy).toHaveBeenCalledTimes(3)
    expect(outputSchemaValidateSpy).toHaveBeenCalledTimes(3)

    expect(mid2).toHaveBeenCalledTimes(3)
    expect(mid2).toHaveBeenNthCalledWith(1, expect.objectContaining({ context: { auth: 3 } }), 'inputSchema__INPUT', expect.any(Function))
    expect(mid2).toHaveNthResolvedWith(1, expect.objectContaining({ output: '__1__' }))
    expect(mid2).toHaveBeenNthCalledWith(2, expect.objectContaining({ context: { auth: 4 } }), 'inputSchema__INPUT', expect.any(Function))
    expect(mid2).toHaveNthResolvedWith(2, expect.objectContaining({ output: '__2__' }))
    expect(mid2).toHaveBeenNthCalledWith(3, expect.objectContaining({ context: { auth: 5 } }), 'inputSchema__INPUT', expect.any(Function))
    expect(mid2).toHaveNthResolvedWith(3, expect.objectContaining({ output: '__4__' }))

    expect(handler).toHaveBeenCalledTimes(4)
    expect(handler).toHaveBeenNthCalledWith(1, expect.objectContaining({ context: { auth: 6 } }), 'inputSchema__INPUT')
    expect(handler).toHaveBeenNthCalledWith(2, expect.objectContaining({ context: { auth: 7 } }), 'inputSchema__INPUT')
    expect(handler).toHaveBeenNthCalledWith(3, expect.objectContaining({ context: { auth: 8 } }), 'inputSchema__INPUT')
    expect(handler).toHaveBeenNthCalledWith(4, expect.objectContaining({ context: { auth: 9 } }), 'inputSchema__INPUT')
  })

  it('client context', async () => {
    const context = vi.fn().mockResolvedValue({ auth: true })
    const client = createProcedureClient(procedure, { context })

    await client(undefined, { context: { from: 'client_context' } })

    expect(context).toHaveBeenCalledTimes(1)
    expect(context).toHaveBeenCalledWith({ from: 'client_context' })
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ context: { auth: true } }), undefined)
  })

  it('trace output AsyncIteratorObject and use override for proxy', async () => {
    const handlerIterator = (async function* () {
      yield 'event'
      return 'result'
    })()
    handler.mockResolvedValueOnce(handlerIterator as any)

    const client = createProcedureClient(procedure)

    const iterator = await client() as any
    expect(iterator).toSatisfy(isAsyncIteratorObject)

    expect(overrideSpy).toHaveBeenCalledTimes(1)
    expect(overrideSpy).toHaveBeenCalledWith(handlerIterator, expect.any(Object))
    expect(iterator).toBe(overrideSpy.mock.results[0]!.value)

    await expect(iterator.next()).resolves.toEqual({ value: 'event', done: false })
    await expect(iterator.next()).resolves.toEqual({ value: 'result', done: true })
  })

  it('trace output readable stream and use override for proxy', async () => {
    const handlerStream = new ReadableStream({
      start(controller) {
        controller.enqueue('event')
        controller.close()
      },
    })
    handler.mockResolvedValueOnce(handlerStream as any)

    const client = createProcedureClient(procedure)

    const stream = await client() as any
    expect(stream).toBeInstanceOf(ReadableStream)

    expect(overrideSpy).toHaveBeenCalledTimes(1)
    expect(overrideSpy).toHaveBeenCalledWith(handlerStream, expect.any(Object))
    expect(stream).toBe(overrideSpy.mock.results[0]!.value)

    const reader = stream.getReader()
    await expect(reader.read()).resolves.toEqual({ value: 'event', done: false })
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
  })

  describe('reconcile error', () => {
    const errorMap: ErrorMap = {
      BAD_REQUEST: { message: 'Bad Request' },
    }
    const procedure = os.use(mid1).errors(errorMap).use(mid2).handler(handler)
    const client = createProcedureClient(procedure, { interceptors: [interceptor] })

    describe('marks returned errors as inferable', () => {
      it('normal error', async () => {
        const error = new ORPCError('ANY_CODE', { data: 'data' })
        handler.mockResolvedValueOnce(error as any)

        const expectError = new ORPCError('ANY_CODE', { data: 'data' })
        ;(expectError as any).inferable = true

        let expectedError
        await expect(client()).rejects.toThrow(expectError)

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(expectedError)

        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(expectedError)

        expect(mid2).toHaveBeenCalledTimes(1)
        await expect(mid2.mock.results[0]!.value).rejects.toThrow(expectedError)

        expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
        expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, expectError)
      })

      it('inferable error', async () => {
        const inferableError = new ORPCError('ANY_CODE', { data: 'data' })
        ;(inferableError as any).inferable = true
        handler.mockResolvedValueOnce(inferableError as any)

        await expect(client()).rejects.toBe(inferableError)
        // do not clone if error already inferable and not defined
        expect(cloneORPCErrorSpy).toHaveBeenCalledTimes(0)

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(inferableError)

        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(inferableError)

        expect(mid2).toHaveBeenCalledTimes(1)
        await expect(mid2.mock.results[0]!.value).rejects.toThrow(inferableError)

        expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
        expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, inferableError)
      })

      it('defined error but do not exists in error map', async () => {
        const definedError = new ORPCError('ANY_CODE', { data: 'data' })
        ;(definedError as any).defined = true
        ;(definedError as any).inferable = true
        handler.mockResolvedValueOnce(definedError as any)

        const expectError = new ORPCError('ANY_CODE', { data: 'data' })
        ;(expectError as any).inferable = true

        let expectedError
        await expect(client()).rejects.toThrow(expectError)

        expect(interceptor).toHaveBeenCalledTimes(1)
        await expect(interceptor.mock.results[0]!.value).rejects.toThrow(expectedError)

        expect(mid1).toHaveBeenCalledTimes(1)
        await expect(mid1.mock.results[0]!.value).rejects.toThrow(expectedError)

        expect(mid2).toHaveBeenCalledTimes(1)
        await expect(mid2.mock.results[0]!.value).rejects.toThrow(expectedError)

        expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
        expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, expectError)
      })
    })

    it('preserves returned errors when opaqueReturnedErrors is enabled', async () => {
      const error = new ORPCError('ANY_CODE', { data: 'data' })
      const opaqueProcedure = os.use(mid1).errors(errorMap).use(mid2).handler(handler)
      opaqueProcedure['~orpc'].opaqueReturnedErrors = true
      const opaqueClient = createProcedureClient(opaqueProcedure, { interceptors: [interceptor] })
      handler.mockResolvedValueOnce(error as any)

      await expect(opaqueClient()).rejects.toBe(error)

      expect(cloneORPCErrorSpy).toHaveBeenCalledTimes(0)
      expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
      expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, error)

      expect(interceptor).toHaveBeenCalledTimes(1)
      await expect(interceptor.mock.results[0]!.value).rejects.toThrow(error)

      expect(mid1).toHaveBeenCalledTimes(1)
      await expect(mid1.mock.results[0]!.value).rejects.toThrow(error)

      expect(mid2).toHaveBeenCalledTimes(1)
      await expect(mid2.mock.results[0]!.value).rejects.toThrow(error)

      expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
      expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, error)
    })

    it('reconcile error before throw', async () => {
      const error = new ORPCError('BAD_REQUEST', { data: 'data' })
      handler.mockRejectedValueOnce(error)
      const reconciledError = new ORPCError('__reconciled__')
      reconcileErrorSpy.mockResolvedValueOnce(reconciledError)

      await expect(client()).rejects.toThrow(reconciledError)

      expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
      expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, error)
    })

    describe('asyncIteratorObject', () => {
      it('reconcile error event before throw', async () => {
        const error = new ORPCError('BAD_REQUEST', { data: 'data' })
        handler.mockResolvedValueOnce((async function* () {
          throw error
        })() as any)
        const reconciledError = new ORPCError('__reconciled__')
        reconcileErrorSpy.mockResolvedValueOnce(reconciledError)

        const iterator = await client() as any
        expect(iterator).toSatisfy(isAsyncIteratorObject)

        await expect(iterator.next()).rejects.toThrow(reconciledError)

        expect(reconcileErrorSpy).toHaveBeenCalledTimes(1)
        expect(reconcileErrorSpy).toHaveBeenCalledWith(errorMap, error)
      })
    })
  })
})
