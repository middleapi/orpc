import type { BatchResponseBodyItem } from './response'
import { isAsyncIteratorObject } from '@orpc/shared'
import { parseBatchResponse, toBatchResponse } from './response'

describe('toBatchResponse & parseBatchResponse', () => {
  const r1: BatchResponseBodyItem = { index: 0, status: 200, headers: { }, body: 'test1' }
  const r2: BatchResponseBodyItem = { index: 1, status: 207, headers: { 'x-custom': 'value2' }, body: 'test2' }

  it('success', async () => {
    const response = toBatchResponse({
      status: 207,
      headers: { 'x-custom': 'value' },
      body: (async function* () {
        yield r1
        yield r2
      })(),
    })

    expect(response.status).toEqual(207)
    expect(response.headers).toEqual({ 'x-custom': 'value' })

    const parsed = parseBatchResponse(response)

    expect(parsed).toSatisfy(isAsyncIteratorObject)

    await expect(parsed.next()).resolves.toEqual({ done: false, value: r1 })
    await expect(parsed.next()).resolves.toEqual({ done: false, value: r2 })
    await expect(parsed.next()).resolves.toEqual({ done: true, value: undefined })
  })
})

describe('parseBatchResponse', () => {
  it('throw on invalid batch body', () => {
    expect(
      () => parseBatchResponse({ status: 207, headers: { 'x-custom': 'value' }, body: undefined }),
    ).toThrow('Invalid batch response')

    expect(
      () => parseBatchResponse({ status: 207, headers: { 'x-custom': 'value' }, body: '123' }),
    ).toThrow('Invalid batch response')
  })

  it('throw on invalid batch item', async () => {
    const parsed = parseBatchResponse(toBatchResponse({
      status: 207,
      headers: { 'x-custom': 'value' },
      body: (async function* () {
        yield { headers: {} } as any
      })(),
    }))

    await expect(parsed.next()).rejects.toThrow('Invalid batch response')
  })
})
