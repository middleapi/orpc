import { ORPCError } from '@orpc/client'
import { CSRFGuardHandlerPlugin } from './csrf-guard'

function makeRequest(headers: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    url: '/ping',
    headers,
    signal: new AbortController().signal,
  } as any
}

function getInterceptor() {
  const existingInterceptor = vi.fn()

  const options = new CSRFGuardHandlerPlugin<any>().init({
    interceptors: [existingInterceptor],
  } as any)

  return {
    interceptor: options.interceptors![1]!,
    existingInterceptor,
    interceptors: options.interceptors!,
  }
}

async function invokeInterceptor(headers: Record<string, unknown>) {
  const nextResult = { response: 'ok' as const }
  const next = vi.fn().mockResolvedValue(nextResult)
  const { interceptor } = getInterceptor()

  const result = await interceptor({
    context: {},
    request: makeRequest(headers),
    next,
  } as any)

  return { result, next, nextResult }
}

describe('csrfGuardHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends its interceptor after existing interceptors', () => {
    const { interceptors, existingInterceptor } = getInterceptor()

    expect(interceptors).toHaveLength(2)
    expect(interceptors[0]).toBe(existingInterceptor)
    expect(interceptors[1]).not.toBe(existingInterceptor)
  })

  it('passes through when the request has no sec-fetch-mode header', async () => {
    const { result, next, nextResult } = await invokeInterceptor({})

    expect(next).toHaveBeenCalledOnce()
    expect(result).toBe(nextResult)
  })

  it.each([
    'cors',
    'same-origin',
    'CORS',
  ])('passes through when sec-fetch-mode is %s', async (mode) => {
    const { result, next, nextResult } = await invokeInterceptor({
      'sec-fetch-mode': mode,
    })

    expect(next).toHaveBeenCalledOnce()
    expect(result).toBe(nextResult)
  })

  it.each([
    'navigate',
    'no-cors',
    'websocket',
  ])('blocks browser navigation-like requests when sec-fetch-mode is %s', async (mode) => {
    const next = vi.fn()
    const { interceptor } = getInterceptor()

    await expect(interceptor({
      context: {},
      request: makeRequest({
        'sec-fetch-mode': mode,
      }),
      next,
    } as any)).rejects.toEqual(new ORPCError('FORBIDDEN', {
      message: 'Request blocked by CSRF protection.',
    }))

    expect(next).not.toHaveBeenCalled()
  })
})
