import { getEventMeta, ORPCError, withEventMeta } from '@orpc/client'
import { StandardLink } from '@orpc/client/standard'
import * as z from 'zod'
import { ValidationError } from '../error'
import { reconcileORPCError } from '../error-utils'
import { ProcedureContract } from '../procedure'
import { asyncIteratorObject } from '../schema-built-in'
import { ResponseValidationLinkPlugin } from './response-validation'

vi.mock('../error-utils', async original => ({
  ...await original(),
  reconcileORPCError: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('responseValidationLinkPlugin', () => {
  const procedure = new ProcedureContract({
    outputSchemas: [
      z.object({
        value: z.number().transform(value => value + 1),
      }),
      z.object({
        value: z.string().transform(value => Number.parseInt(value)),
      }),
    ],
    errorMap: {
      TEST: {
        data: z.object({
          value: z.string().transform(value => Number.parseInt(value)),
        }),
      },
    },
    meta: {},
  })

  const withoutOutputSchemaProcedure = new ProcedureContract({
    errorMap: {},
    meta: {},
  })

  const streamProcedure = new ProcedureContract({
    outputSchemas: [asyncIteratorObject(z.number())],
    errorMap: procedure['~orpc'].errorMap,
    meta: {},
  })

  const contract = {
    procedure,
    nested: {
      procedure,
    },
    withoutOutputSchema: withoutOutputSchemaProcedure,
    stream: streamProcedure,
  }

  const codec = {
    encodeInput: vi.fn(),
    decodeResponse: vi.fn(),
  }

  const transport = {
    send: vi.fn(),
  }

  const interceptor = vi.fn(({ next }) => next())

  const link = new StandardLink(codec, transport, {
    plugins: [
      new ResponseValidationLinkPlugin(contract),
    ],
    interceptors: [interceptor],
  })

  function mockResponse(url: string, decoded: unknown, status = 200) {
    codec.encodeInput.mockResolvedValueOnce({ method: 'POST', url, headers: {}, body: '__encoded__' })
    transport.send.mockResolvedValueOnce({ status, headers: {}, resolveBody: () => Promise.resolve('__body__') })
    codec.decodeResponse.mockResolvedValueOnce(decoded)
  }

  it('validates output using the output schema pipeline', async () => {
    mockResponse('/procedure', { kind: 'output', output: { value: '123' } })

    const output = await link.call(['procedure'], {}, { context: {} })

    expect(output).toEqual({ value: 124 })
    expect(await interceptor.mock.results[0]?.value).toEqual({ value: 124 })
  })

  it('skips validation when the procedure has no output schemas', async () => {
    mockResponse('/withoutOutputSchema', { kind: 'output', output: 'anything' })

    const output = await link.call(['withoutOutputSchema'], {}, { context: {} })

    expect(output).toBe('anything')
    expect(await interceptor.mock.results[0]?.value).toBe('anything')
  })

  it('throws INTERNAL_SERVER_ERROR when output validation fails', async () => {
    mockResponse('/procedure', { kind: 'output', output: 'invalid' })

    const expectedError = new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Output validation failed',
      cause: expect.any(ValidationError),
    })

    vi.mocked(reconcileORPCError).mockImplementationOnce(async (map, error) => {
      expect(map).toBe(contract.procedure['~orpc'].errorMap)
      expect(error).toBeInstanceOf(ORPCError)
      expect(error.code).toBe('INTERNAL_SERVER_ERROR')
      expect(error.message).toBe('Output validation failed')
      expect(error.cause).toBeInstanceOf(ValidationError)
      expect((error.cause as ValidationError).invalidData).toBe('invalid')

      return expectedError
    })

    await expect(link.call(['procedure'], {}, { context: {} })).rejects.toBe(expectedError)
    await expect(interceptor.mock.results[0]?.value).rejects.toEqual(expectedError)
  })

  it('reconciles thrown ORPCError instances against the contract', async () => {
    const error = new ORPCError('TEST', { message: 'test', data: { value: '123' } })
    const reconciled = new ORPCError('TEST', { message: 'test', data: { value: 123 } })

    mockResponse('/nested/procedure', { kind: 'error', error }, 400)
    vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

    await expect(link.call(['nested', 'procedure'], {}, { context: {} })).rejects.toBe(reconciled)
    await expect(interceptor.mock.results[0]?.value).rejects.toBe(error)

    expect(reconcileORPCError).toHaveBeenCalledWith(contract.nested.procedure['~orpc'].errorMap, error)
  })

  it('rethrows non-ORPCError failures without reconciliation', async () => {
    const error = new Error('plain failure')

    codec.encodeInput.mockResolvedValueOnce({ method: 'POST', url: '/nested/procedure', headers: {}, body: '__encoded__' })
    transport.send.mockResolvedValueOnce({ status: 500, headers: {}, resolveBody: () => Promise.resolve('__body__') })
    codec.decodeResponse.mockRejectedValueOnce(error)

    await expect(link.call(['nested', 'procedure'], {}, { context: {} })).rejects.toBe(error)
    await expect(interceptor.mock.results[0]?.value).rejects.toBe(error)

    expect(reconcileORPCError).not.toHaveBeenCalled()
  })

  describe('async iterator output', () => {
    it('reconciles ORPCError thrown while consuming the iterator', async () => {
      const error = new ORPCError('TEST', { data: { value: '123' } })
      const reconciled = new ORPCError('TEST', { data: { value: 123 } })

      mockResponse('/stream', {
        kind: 'output',
        output: (async function* () {
          yield 1
          throw error
        })(),
      })
      vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      expect(reconcileORPCError).not.toHaveBeenCalled()
      await expect(output.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(output.next()).rejects.toBe(reconciled)

      expect(reconcileORPCError).toHaveBeenCalledTimes(1)
      expect(reconcileORPCError).toHaveBeenCalledWith(contract.stream['~orpc'].errorMap, error)
    })

    it('preserves event meta of reconciled mid-stream errors', async () => {
      const error = withEventMeta(new ORPCError('TEST', { data: { value: '123' } }), { id: 'id-1', retry: 1000 })
      const reconciled = new ORPCError('TEST', { data: { value: 123 } })

      mockResponse('/stream', {
        kind: 'output',
        output: (async function* () {
          throw error
        })(),
      })
      vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      const thrown = await output.next().catch(e => e)

      expect(thrown).toBeInstanceOf(ORPCError)
      expect(thrown.data).toEqual({ value: 123 })
      expect(getEventMeta(thrown)).toEqual({ id: 'id-1', retry: 1000 })
    })

    it('rethrows non-ORPCError mid-stream failures without reconciliation', async () => {
      const error = new Error('plain failure')

      mockResponse('/stream', {
        kind: 'output',
        output: (async function* () {
          throw error
        })(),
      })

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      await expect(output.next()).rejects.toBe(error)
      expect(reconcileORPCError).not.toHaveBeenCalled()
    })

    it('marks mid-stream errors as defined and applies the error data schema', async () => {
      const { reconcileORPCError: actualReconcileORPCError } = await vi.importActual<typeof import('../error-utils')>('../error-utils')
      vi.mocked(reconcileORPCError).mockImplementation(actualReconcileORPCError)
      onTestFinished(() => {
        vi.mocked(reconcileORPCError).mockReset()
      })

      mockResponse('/stream', {
        kind: 'output',
        output: (async function* () {
          yield 1
          throw new ORPCError('TEST', { data: { value: '123' } })
        })(),
      })

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      await expect(output.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(output.next()).rejects.toSatisfy((error: any) =>
        error instanceof ORPCError && error.defined === true && error.data.value === 123,
      )
    })
  })
})
