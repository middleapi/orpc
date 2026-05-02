import type { StandardLazyResponse } from './types'
import * as SharedModule from '@orpc/shared'
import { flattenHeader, generateContentDisposition, getFilenameFromContentDisposition, isEventIteratorHeaders, mergeStandardHeaders, replicateStandardLazyResponse } from './utils'

const replicateAsyncIteratorSpy = vi.spyOn(SharedModule, 'replicateAsyncIterator')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateContentDisposition', () => {
  it('handle normal filename', () => {
    expect(generateContentDisposition('test.txt')).toEqual('inline; filename="test.txt"; filename*=utf-8\'\'test.txt')
  })

  it('handle empty filename', () => {
    expect(generateContentDisposition('')).toEqual('inline; filename=""; filename*=utf-8\'\'')
  })

  it('escape " special char', () => {
    expect(generateContentDisposition('!@#$%^%^&*()\'".txt')).toEqual('inline; filename="!@#$%^%^&*()\'\\".txt"; filename*=utf-8\'\'!%40%23%24%25^%25^%26%2A%28%29%27%22.txt')
  })

  it('escape non-ASCII filenames', () => {
    expect(generateContentDisposition('テンプレ\'"ート.txt')).toEqual('inline; filename="____\'\\"__.txt"; filename*=utf-8\'\'%E3%83%86%E3%83%B3%E3%83%97%E3%83%AC%27%22%E3%83%BC%E3%83%88.txt')
  })
})

it('getFilenameFromContentDisposition', () => {
  expect(getFilenameFromContentDisposition('attachment; filename=""; filename*=utf-8\'\'')).toEqual('')
  expect(getFilenameFromContentDisposition('attachment; filename="test.txt"; filename*=utf-8\'\'test.txt')).toEqual('test.txt')
  expect(getFilenameFromContentDisposition('attachment; filename="!@#$%^%^&*()\'".txt"; filename*=utf-8\'\'!%40%23%24%25^%25^%26%2A%28%29%27%22.txt')).toEqual('!@#$%^%^&*()\'".txt')

  expect(getFilenameFromContentDisposition('attachment; filename=""')).toEqual('')
  expect(getFilenameFromContentDisposition('attachment; filename="test.txt"')).toEqual('test.txt')
  expect(getFilenameFromContentDisposition('attachment; filename="!@#$%^%^&*()\'\\".txt"')).toEqual('!@#$%^%^&*()\'".txt')

  expect(getFilenameFromContentDisposition('attachment; filename*=utf-8\'\'')).toEqual('')
  expect(getFilenameFromContentDisposition('attachment; filename*=utf-8\'\'test.txt')).toEqual('test.txt')
  expect(getFilenameFromContentDisposition('attachment; filename*=utf-8\'\'!%40%23%24%25^%25^%26%2A%28%29%27%22.txt')).toEqual('!@#$%^%^&*()\'".txt')

  expect(getFilenameFromContentDisposition('inline; filename="hello.txt"')).toEqual('hello.txt')
  expect(getFilenameFromContentDisposition('inline; filename="hello.txt"; size=123')).toEqual('hello.txt')
  expect(getFilenameFromContentDisposition('inline; filename"hello.txt"; size=123')).toEqual(undefined)

  expect(getFilenameFromContentDisposition('inline; filename*=!%40%23%24%25^%25^%26%2A%28%29%27%22.txt; size=123')).toEqual('!@#$%^%^&*()\'".txt')
})

it('mergeStandardHeaders', () => {
  expect(mergeStandardHeaders({ a: '1' }, { a: '2' })).toEqual({ a: ['1', '2'] })
  expect(mergeStandardHeaders({ a: ['1'] }, { a: '2' })).toEqual({ a: ['1', '2'] })
  expect(mergeStandardHeaders({ a: ['1', '2'] }, { a: '3' })).toEqual({ a: ['1', '2', '3'] })
  expect(mergeStandardHeaders({ a: ['1', '2'] }, { a: ['3'] })).toEqual({ a: ['1', '2', '3'] })
  expect(mergeStandardHeaders({ a: ['1', '2'] }, { a: ['3', '4'] })).toEqual({ a: ['1', '2', '3', '4'] })

  expect(mergeStandardHeaders({ a: '1' }, { b: '2' })).toEqual({ a: '1', b: '2' })
  expect(mergeStandardHeaders({ a: '1', b: undefined }, { b: '2' })).toEqual({ a: '1', b: '2' })
  expect(mergeStandardHeaders({ a: '1' }, { a: undefined, b: '2' })).toEqual({ a: '1', b: '2' })
})

it('flattenHeader', () => {
  expect(flattenHeader(['a', 'b'])).toEqual('a, b')
  expect(flattenHeader([])).toEqual(undefined)
  expect(flattenHeader('a')).toEqual('a')
  expect(flattenHeader(undefined)).toEqual(undefined)
})

describe('replicateStandardLazyResponse', () => {
  it('without async iterator', async () => {
    const response: StandardLazyResponse = {
      headers: {
        'x-test': 'test',
      },
      body: vi.fn(async () => 'test'),
      status: 200,
    }

    const replicated = replicateStandardLazyResponse(response, 3)

    expect(replicated.length).toBe(3)

    expect(await replicated[0]!.body()).toBe('test')
    expect(await replicated[1]!.body()).toBe('test')
    expect(await replicated[2]!.body()).toBe('test')

    expect(replicated[0]!.headers).toEqual({ 'x-test': 'test' })
    expect(replicated[1]!.headers).toEqual({ 'x-test': 'test' })
    expect(replicated[2]!.headers).toEqual({ 'x-test': 'test' })

    expect(replicated[0]!.status).toBe(200)
    expect(replicated[1]!.status).toBe(200)
    expect(replicated[2]!.status).toBe(200)

    expect(response.body).toHaveBeenCalledTimes(1)
    expect(replicateAsyncIteratorSpy).toHaveBeenCalledTimes(0)
  })

  it('with async iterator', async () => {
    const iterator = (async function* () {
      yield 'test'
      yield 'test'
    }())

    const response: StandardLazyResponse = {
      headers: {
        'x-test': 'test',
      },
      body: async () => iterator,
      status: 200,
    }

    expect(replicateAsyncIteratorSpy).toHaveBeenCalledTimes(0)
    const replicated = replicateStandardLazyResponse(response, 3)
    expect(replicated.length).toBe(3)

    expect(replicated[0]!.headers).toEqual({ 'x-test': 'test' })
    expect(replicated[1]!.headers).toEqual({ 'x-test': 'test' })
    expect(replicated[2]!.headers).toEqual({ 'x-test': 'test' })

    expect(replicated[0]!.status).toBe(200)
    expect(replicated[1]!.status).toBe(200)
    expect(replicated[2]!.status).toBe(200)

    replicateAsyncIteratorSpy.mockReturnValueOnce([1, 2, 3] as any)

    // parallel test is important
    await Promise.all([
      expect(replicated[0]!.body()).resolves.toEqual(1),
      expect(replicated[1]!.body()).resolves.toEqual(2),
    ])

    expect(await replicated[0]!.body()).toBe(1) // make sure cached
    expect(await replicated[1]!.body()).toBe(2) // make sure cached

    expect(await replicated[2]!.body()).toBe(3)
    expect(await replicated[2]!.body()).toBe(3) // make sure cached

    expect(replicateAsyncIteratorSpy).toHaveBeenCalledTimes(1)
    expect(replicateAsyncIteratorSpy).toHaveBeenCalledWith(iterator, 3)
  })
})

it('isEventIteratorHeaders', () => {
  expect(isEventIteratorHeaders({
    'content-type': 'text/event-stream',
  })).toBe(true)

  expect(isEventIteratorHeaders({
    'content-type': 'text/event-stream',
    'content-disposition': '',
  })).toBe(false)

  expect(isEventIteratorHeaders({
    'content-type': 'text/plain',
  })).toBe(false)

  expect(isEventIteratorHeaders({
    'content-disposition': 'attachment; filename="test.pdf"',
  })).toBe(false)
})
