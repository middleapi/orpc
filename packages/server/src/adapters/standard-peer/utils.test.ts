import type { StandardLazyRequest } from '@standard-server/core'

import { createStandardPeerRequestHandler } from './utils'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createStandardPeerRequestHandler', () => {
  it('returns matched response and forwards lazy request', async () => {
    const response = { status: 200, headers: { 'x-test': 'ok' }, body: 'ok' }

    const handler = {
      handle: vi.fn(async () => ({ matched: true, response })),
    } as any

    const handleRequest = createStandardPeerRequestHandler(handler, {
      context: { context: true },
      prefix: '/api',
    })

    const request: StandardLazyRequest = {
      resolveBody: async () => 'request-body',
      headers: { 'x-custom': 'value' },
      method: 'GET',
      url: '/api/test',
      signal: new AbortController().signal,
    }

    const result = await handleRequest(request)

    expect(result).toEqual(response)

    expect(handler.handle).toHaveBeenCalledTimes(1)
    expect(handler.handle).toHaveBeenCalledWith(request, {
      context: { context: true },
      prefix: '/api',
    })
  })

  it('returns 404 response when no procedure matched', async () => {
    const notFound = { status: 404, headers: {}, body: 'encoded' }
    const handler = {
      handle: vi.fn(async () => ({ matched: false, response: undefined })),
      encodeError: vi.fn(() => notFound),
    } as any

    const handleRequest = createStandardPeerRequestHandler(handler, { context: { context: true } })

    const result = await handleRequest({
      resolveBody: async () => 'request-body',
      headers: { 'x-custom': 'value' },
      method: 'GET',
      url: '/api/test',
      signal: new AbortController().signal,
    })

    expect(result).toBe(notFound)
    expect(handler.encodeError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND', message: 'No procedure matched' }),
    )
    expect(handler.handle).toHaveBeenCalledTimes(1)
  })

  it('context fallback to empty object when it undefined', async () => {
    const handler = {
      handle: vi.fn(async () => ({ matched: false, response: undefined })),
      encodeError: vi.fn(),
    } as any

    const handleRequest = createStandardPeerRequestHandler(handler, {})

    const lazyRequest = {
      resolveBody: async () => 'request-body',
      headers: { 'x-custom': 'value' },
      method: 'GET',
      url: '/api/test',
      signal: new AbortController().signal,
    } as const

    await handleRequest(lazyRequest)
    expect(handler.handle).toHaveBeenCalledTimes(1)
    expect(handler.handle).toHaveBeenCalledWith(lazyRequest, { context: {} })
  })

  it('forwards a context function unresolved so the handler resolves it after its prefix check', async () => {
    const handler = {
      handle: vi.fn(async () => ({ matched: false, response: undefined })),
      encodeError: vi.fn(),
    } as any

    const context = vi.fn(() => ({ db: 'postgres' }))
    const handleRequest = createStandardPeerRequestHandler(handler, { context })

    const lazyRequest = {
      resolveBody: async () => 'request-body',
      headers: { 'x-custom': 'value' },
      method: 'GET',
      url: '/api/test',
      signal: new AbortController().signal,
    } as const
    await handleRequest(lazyRequest)

    expect(context).not.toHaveBeenCalled()
    expect(handler.handle).toHaveBeenCalledTimes(1)
    expect(handler.handle).toHaveBeenCalledWith(lazyRequest, { context })
  })
})
