import type { StandardResponse } from '@orpc/standard-server'
import * as Body from './body'
import * as Headers from './headers'
import { toFetchResponse, toStandardLazyResponse } from './response'

const toFetchBodySpy = vi.spyOn(Body, 'toFetchBody')
const toStandardBodySpy = vi.spyOn(Body, 'toStandardBody')
const toFetchHeadersSpy = vi.spyOn(Headers, 'toFetchHeaders')
const toStandardHeadersSpy = vi.spyOn(Headers, 'toStandardHeaders')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toFetchResponse', () => {
  it('works', async () => {
    const standardResponse: StandardResponse = {
      body: { value: 123 },
      headers: {
        'x-custom-header': 'custom-value',
      },
      status: 206,
    }

    const options = { eventIteratorKeepAliveEnabled: true }

    const fetchResponse = toFetchResponse(standardResponse, options)

    expect(fetchResponse.status).toBe(206)
    expect([...fetchResponse.headers]).toEqual([
      ['content-type', 'application/json'],
      ['x-custom-header', 'custom-value'],
    ])
    expect(fetchResponse.headers).toEqual(toFetchHeadersSpy.mock.results[0]!.value)
    expect(await fetchResponse.text()).toBe(toFetchBodySpy.mock.results[0]!.value)

    expect(toFetchHeadersSpy).toBeCalledTimes(1)
    expect(toFetchHeadersSpy).toBeCalledWith(standardResponse.headers)

    expect(toFetchBodySpy).toBeCalledTimes(1)
    expect(toFetchBodySpy).toBeCalledWith(standardResponse.body, fetchResponse.headers, options)
  })

  it('cancel async generator when client cancels', async () => {
    let finished = false
    let hasFinally = false
    async function* gen() {
      try {
        yield 'foo'
        yield 'bar'
        yield 'hi'
        finished = true
      }
      finally {
        hasFinally = true
      }
    }

    const response = toFetchResponse({
      body: gen(),
      headers: {},
      status: 209,
    }, {})

    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()

    expect((await reader.read()).value).toEqual(': \n\n')
    expect((await reader.read()).value).toEqual('event: message\ndata: "foo"\n\n')
    await reader.cancel()
    await vi.waitFor(() => {
      expect(hasFinally).toBe(true)
      expect(finished).toBe(false)
    })
  })
})

describe('toStandardLazyResponse', () => {
  it('works', () => {
    const response = new Response(JSON.stringify({ value: 123 }), {
      headers: {
        'x-custom-header': 'custom-value',
        'content-type': 'application/json',
      },
      status: 206,
    })

    const signal = AbortSignal.timeout(100)
    const lazyResponse = toStandardLazyResponse(response, { signal })

    expect(lazyResponse.status).toBe(206)

    expect(lazyResponse.headers).toBe(toStandardHeadersSpy.mock.results[0]!.value)
    expect(toStandardHeadersSpy).toBeCalledTimes(1)
    expect(toStandardHeadersSpy).toBeCalledWith(response.headers)

    expect(lazyResponse.body()).toBe(toStandardBodySpy.mock.results[0]!.value)
    expect(toStandardBodySpy).toBeCalledTimes(1)
    expect(toStandardBodySpy).toBeCalledWith(response, { signal })
  })

  it('lazy headers', async () => {
    const response = new Response(null, {
      headers: {
        'x-custom-header': 'custom-value',
      },
    })

    const lazyResponse = toStandardLazyResponse(response)

    expect(toStandardHeadersSpy).toBeCalledTimes(0)
    lazyResponse.headers = { overrided: '1' }
    expect(lazyResponse.headers).toEqual({ overrided: '1' }) // can override before access
    expect(toStandardHeadersSpy).toBeCalledTimes(0)

    const lazyResponse2 = toStandardLazyResponse(response)
    expect(lazyResponse2.headers).toEqual(toStandardHeadersSpy.mock.results[0]!.value)
    expect(lazyResponse2.headers).toEqual(toStandardHeadersSpy.mock.results[0]!.value) // ensure cached
    expect(toStandardHeadersSpy).toBeCalledTimes(1)

    lazyResponse2.headers = { overrided: '2' }
    expect(lazyResponse2.headers).toEqual({ overrided: '2' }) // can override after access
  })

  it('lazy body', async () => {
    const response = new Response('value')

    const lazyResponse = toStandardLazyResponse(response)

    expect(toStandardBodySpy).toBeCalledTimes(0)
    const overrideBody = () => Promise.resolve('1')
    lazyResponse.body = overrideBody
    expect(lazyResponse.body).toBe(overrideBody)
    expect(toStandardBodySpy).toBeCalledTimes(0)

    const lazyResponse2 = toStandardLazyResponse(response)
    expect(lazyResponse2.body()).toEqual(toStandardBodySpy.mock.results[0]!.value)
    expect(lazyResponse2.body()).toEqual(toStandardBodySpy.mock.results[0]!.value) // ensure cached
    expect(toStandardBodySpy).toBeCalledTimes(1)
  })
})
