import { ContractProcedure } from '@orpc/contract'
import { createProcedureClient, lazy, Procedure } from '@orpc/server'
import { ORPC_HANDLER_HEADER, ORPC_HANDLER_VALUE } from '@orpc/shared'
import { LinearRouter } from 'hono/router/linear-router'
import { PatternRouter } from 'hono/router/pattern-router'
import { TrieRouter } from 'hono/router/trie-router'
import { OpenAPIHandler } from './openapi-handler'

vi.mock('@orpc/server', async original => ({
  ...await original(),
  createProcedureClient: vi.fn(() => vi.fn()),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

const hono = [
  ['LinearRouter', new LinearRouter<any>()],
  // ['RegExpRouter', new RegExpRouter<any>()],
  ['TrieRouter', new TrieRouter<any>()],
  ['PatternRouter', new PatternRouter<any>()],
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe.each(hono)('openAPIHandler: %s', (_, hono) => {
  const ping = new Procedure({
    contract: new ContractProcedure({
      route: {
        method: 'GET',
        path: '/ping',
      },
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    handler: vi.fn(),
  })
  const pong = new Procedure({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
      route: {
        method: 'POST',
        path: '/pong/{name}',
      },
    }),
    handler: vi.fn(),
  })

  const router = {
    ping: lazy(() => Promise.resolve({ default: ping })),
    pong,
    nested: lazy(() => Promise.resolve({
      default: {
        ping,
        pong: lazy(() => Promise.resolve({ default: pong })),
      },
    })),
  }

  it('should return a 404 response if no matching procedure is found', async () => {
    const handler = new OpenAPIHandler(hono, router)

    const mockRequest = new Request('https://example.com/not_found', {
      headers: new Headers({}),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(404)

    const body = await response?.text()
    expect(body).toContain('Not found')
  })

  it('should return a 200 response with serialized output if procedure is resolved successfully', async () => {
    const handler = new OpenAPIHandler(hono, router)

    const caller = vi.fn().mockReturnValueOnce('__mocked__')
    vi.mocked(createProcedureClient).mockReturnValue(caller)

    const mockRequest = new Request('https://example.com/ping?value=123', {
      headers: new Headers({}),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(200)

    const body = await response?.json()
    expect(body).toEqual('__mocked__')

    expect(caller).toBeCalledTimes(1)
    expect(caller).toBeCalledWith({ value: '123' }, { signal: undefined })
  })

  it('support params', async () => {
    const handler = new OpenAPIHandler(hono, router)

    const caller = vi.fn().mockReturnValueOnce('__mocked__')
    vi.mocked(createProcedureClient).mockReturnValue(caller)

    const mockRequest = new Request('https://example.com/pong/unnoq', {
      method: 'POST',
      body: new Blob([JSON.stringify({ value: '123' })], { type: 'application/json' }),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(200)

    const body = await response?.json()
    expect(body).toEqual('__mocked__')

    expect(caller).toBeCalledTimes(1)
    expect(caller).toBeCalledWith({ value: '123', name: 'unnoq' }, { signal: undefined })
  })

  it('should handle unexpected errors and return a 500 response', async () => {
    const handler = new OpenAPIHandler(hono, router)

    vi.mocked(createProcedureClient).mockImplementationOnce(() => {
      throw new Error('Unexpected error')
    })

    const mockRequest = new Request('https://example.com/ping')

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(500)

    const body = await response?.text()
    expect(body).toContain('Internal server error')
  })

  it('support signal', async () => {
    const handler = new OpenAPIHandler(hono, router)

    const caller = vi.fn().mockReturnValueOnce('__mocked__')
    vi.mocked(createProcedureClient).mockReturnValue(caller)

    const mockRequest = new Request('https://example.com/ping?value=123', {
      headers: new Headers({}),
    })

    const controller = new AbortController()
    const signal = controller.signal

    const response = await handler.fetch(mockRequest, { signal })

    expect(response?.status).toBe(200)

    const body = await response?.json()
    expect(body).toEqual('__mocked__')

    expect(caller).toBeCalledTimes(1)
    expect(caller).toBeCalledWith({ value: '123' }, { signal })
  })

  it('hooks', async () => {
    const mockRequest = new Request('https://example.com/not_found', {
      headers: new Headers({}),
      method: 'POST',
      body: JSON.stringify({ data: { value: '123' }, meta: [] }),
    })

    const onStart = vi.fn()
    const onSuccess = vi.fn()
    const onError = vi.fn()

    const handler = new OpenAPIHandler(hono, router, {
      onStart,
      onSuccess,
      onError,
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(404)

    expect(onStart).toBeCalledTimes(1)
    expect(onSuccess).toBeCalledTimes(0)
    expect(onError).toBeCalledTimes(1)
  })

  it('conditions', () => {
    const handler = new OpenAPIHandler(hono, router)

    expect(handler.condition(new Request('https://example.com'))).toBe(true)
    expect(handler.condition(new Request('https://example.com', {
      headers: new Headers({ [ORPC_HANDLER_HEADER]: ORPC_HANDLER_VALUE }),
    }))).toBe(false)
  })

  it('schema coercer', async () => {
    const coerce = vi.fn().mockReturnValue('__mocked__')

    const handler = new OpenAPIHandler(hono, router, {
      schemaCoercers: [
        {
          coerce,
        },
      ],
    })

    const mockRequest = new Request('https://example.com/ping?value=123', {
      headers: new Headers({}),
    })

    const response = await handler.fetch(mockRequest)

    expect(response?.status).toBe(200)

    expect(coerce).toBeCalledTimes(1)
    expect(coerce).toBeCalledWith(undefined, { value: '123' })
    expect(createProcedureClient).toBeCalledTimes(1)
    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledTimes(1)
    expect(vi.mocked(createProcedureClient).mock.results[0]?.value).toBeCalledWith('__mocked__', { signal: undefined })
  })
})
