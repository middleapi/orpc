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
    errorMap: {
      NOT_FOUND: {
        data: z.object({
          value: z.string().transform(value => Number.parseInt(value)),
        }),
      },
    },
    meta: {},
  })

  const contract = {
    procedure,
    nested: {
      procedure,
    },
    withoutOutputSchema: withoutOutputSchemaProcedure,
    stream: streamProcedure,
    withoutOutputSchemaStream: withoutOutputSchemaProcedure,
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

  it('validates output using the output schema pipeline', async () => {
    codec.encodeInput.mockResolvedValueOnce({
      method: 'POST',
      url: '/procedure',
      headers: {},
      body: '__encoded__',
    })
    transport.send.mockResolvedValueOnce({
      status: 200,
      headers: {},
      resolveBody: () => Promise.resolve('__body__'),
    })
    codec.decodeResponse.mockResolvedValueOnce({
      kind: 'output',
      output: { value: '123' },
    })

    const output = await link.call(['procedure'], {}, { context: {} })

    expect(output).toEqual({ value: 124 })
    expect(await interceptor.mock.results[0]?.value).toEqual({ value: 124 })
  })

  it('skips validation when the procedure has no output schemas', async () => {
    codec.encodeInput.mockResolvedValueOnce({
      method: 'POST',
      url: '/withoutOutputSchema',
      headers: {},
      body: '__encoded__',
    })
    transport.send.mockResolvedValueOnce({
      status: 200,
      headers: {},
      resolveBody: () => Promise.resolve('__body__'),
    })
    codec.decodeResponse.mockResolvedValueOnce({
      kind: 'output',
      output: 'anything',
    })

    const output = await link.call(['withoutOutputSchema'], {}, { context: {} })

    expect(output).toBe('anything')
    expect(await interceptor.mock.results[0]?.value).toBe('anything')
  })

  it('throws INTERNAL_SERVER_ERROR when output validation fails', async () => {
    codec.encodeInput.mockResolvedValueOnce({
      method: 'POST',
      url: '/procedure',
      headers: {},
      body: '__encoded__',
    })
    transport.send.mockResolvedValueOnce({
      status: 200,
      headers: {},
      resolveBody: () => Promise.resolve('__body__'),
    })
    codec.decodeResponse.mockResolvedValueOnce({
      kind: 'output',
      output: 'invalid',
    })

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
    codec.encodeInput.mockResolvedValueOnce({
      method: 'POST',
      url: '/nested/procedure',
      headers: {},
      body: '__encoded__',
    })
    transport.send.mockResolvedValueOnce({
      status: 400,
      headers: {},
      resolveBody: () => Promise.resolve('__body__'),
    })

    const error = new ORPCError('TEST', { message: 'test', data: { value: '123' } })
    const reconciled = new ORPCError('TEST', { message: 'test', data: { value: 123 } })

    codec.decodeResponse.mockResolvedValueOnce({ kind: 'error', error })
    vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

    await expect(link.call(['nested', 'procedure'], {}, { context: {} })).rejects.toBe(reconciled)
    await expect(interceptor.mock.results[0]?.value).rejects.toBe(error)

    expect(reconcileORPCError).toHaveBeenCalledWith(contract.nested.procedure['~orpc'].errorMap, error)
  })

  it('rethrows non-ORPCError failures without reconciliation', async () => {
    codec.encodeInput.mockResolvedValueOnce({
      method: 'POST',
      url: '/nested/procedure',
      headers: {},
      body: '__encoded__',
    })
    transport.send.mockResolvedValueOnce({
      status: 500,
      headers: {},
      resolveBody: () => Promise.resolve('__body__'),
    })

    const error = new Error('plain failure')

    codec.decodeResponse.mockRejectedValueOnce(error)

    await expect(link.call(['nested', 'procedure'], {}, { context: {} })).rejects.toBe(error)
    await expect(interceptor.mock.results[0]?.value).rejects.toBe(error)

    expect(reconcileORPCError).not.toHaveBeenCalled()
  })

  describe('async iterator output', () => {
    function mockStreamResponse(path: string, output: unknown) {
      codec.encodeInput.mockResolvedValueOnce({
        method: 'POST',
        url: path,
        headers: {},
        body: '__encoded__',
      })
      transport.send.mockResolvedValueOnce({
        status: 200,
        headers: {},
        resolveBody: () => Promise.resolve('__body__'),
      })
      codec.decodeResponse.mockResolvedValueOnce({ kind: 'output', output })
    }

    it('reconciles ORPCError thrown while consuming the iterator', async () => {
      const error = new ORPCError('NOT_FOUND', { data: { value: '123' } })
      const reconciled = new ORPCError('NOT_FOUND', { data: { value: 123 } })

      mockStreamResponse('/stream', (async function* () {
        yield 1
        throw error
      })())
      vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      expect(reconcileORPCError).not.toHaveBeenCalled()
      await expect(output.next()).resolves.toEqual({ done: false, value: 1 })
      await expect(output.next()).rejects.toBe(reconciled)

      expect(reconcileORPCError).toHaveBeenCalledTimes(1)
      expect(reconcileORPCError).toHaveBeenCalledWith(contract.stream['~orpc'].errorMap, error)
    })

    it('reconciles mid-stream errors when the procedure has no output schemas', async () => {
      const error = new ORPCError('TEST')
      const reconciled = new ORPCError('TEST', { message: 'reconciled' })

      mockStreamResponse('/withoutOutputSchemaStream', (async function* () {
        throw error
      })())
      vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

      const output = await link.call(['withoutOutputSchemaStream'], {}, { context: {} }) as AsyncIteratorObject<number>

      await expect(output.next()).rejects.toBe(reconciled)
      expect(reconcileORPCError).toHaveBeenCalledWith(contract.withoutOutputSchemaStream['~orpc'].errorMap, error)
    })

    it('preserves event meta of reconciled mid-stream errors', async () => {
      const error = withEventMeta(new ORPCError('NOT_FOUND', { data: { value: '123' } }), { id: 'id-1', retry: 1000 })
      const reconciled = new ORPCError('NOT_FOUND', { data: { value: 123 } })

      mockStreamResponse('/stream', (async function* () {
        throw error
      })())
      vi.mocked(reconcileORPCError).mockResolvedValueOnce(reconciled)

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      const thrown = await output.next().catch(e => e)

      expect(thrown).toBeInstanceOf(ORPCError)
      expect(thrown.data).toEqual({ value: 123 })
      expect(getEventMeta(thrown)).toEqual({ id: 'id-1', retry: 1000 })
    })

    it('rethrows non-ORPCError mid-stream failures without reconciliation', async () => {
      const error = new Error('plain failure')

      mockStreamResponse('/stream', (async function* () {
        throw error
      })())

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      await expect(output.next()).rejects.toBe(error)
      expect(reconcileORPCError).not.toHaveBeenCalled()
    })

    it('reconciles mid-stream errors the same way as direct errors', async () => {
      const { reconcileORPCError: actualReconcileORPCError } = await vi.importActual<typeof import('../error-utils')>('../error-utils')
      vi.mocked(reconcileORPCError).mockImplementation(actualReconcileORPCError)
      onTestFinished(() => {
        vi.mocked(reconcileORPCError).mockReset()
      })

      mockStreamResponse('/stream', (async function* () {
        yield 1
        throw new ORPCError('NOT_FOUND', { data: { value: '123' } })
      })())

      const output = await link.call(['stream'], {}, { context: {} }) as AsyncIteratorObject<number>

      await expect(output.next()).resolves.toEqual({ done: false, value: 1 })
      const streamError = await output.next().catch(e => e)

      codec.encodeInput.mockResolvedValueOnce({ method: 'POST', url: '/stream', headers: {}, body: '__encoded__' })
      transport.send.mockResolvedValueOnce({ status: 404, headers: {}, resolveBody: () => Promise.resolve('__body__') })
      codec.decodeResponse.mockResolvedValueOnce({
        kind: 'error',
        error: new ORPCError('NOT_FOUND', { data: { value: '123' } }),
      })

      const directError: any = await link.call(['stream'], {}, { context: {} }).catch(e => e)

      expect(directError).toBeInstanceOf(ORPCError)
      expect(directError.defined).toBe(true)
      expect(directError.data).toEqual({ value: 123 })

      expect(streamError).toBeInstanceOf(ORPCError)
      expect(streamError.defined).toBe(directError.defined)
      expect(streamError.data).toEqual(directError.data)
    })
  })
})
