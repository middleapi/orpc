import type { StandardLazyResponse, StandardRequest } from '@standard-server/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import * as SharedExperimentalV2Module from '@orpc/shared'
import { AbortError, AsyncIteratorClass, sleep } from '@orpc/shared'
import { ErrorEvent, getEventMeta, withEventMeta } from '@standard-server/core'
import { RPCLinkCodec, StandardLink } from '../adapters/standard'
import { DedupeLinkPlugin } from './dedupe'
import { TimeoutLinkPlugin } from './timeout'

interface TestContext {
  group?: boolean
  tag?: string
}

function makeCodec(): StandardLinkCodec<TestContext> {
  return {
    encodeInput: vi.fn(async (input, path, { signal }) => ({
      method: path[0] as StandardRequest['method'],
      url: `/${path.slice(1).join('/')}` as `/${string}`,
      headers: {
        authorization: 'bearer 123',
        path: path.join('/'),
      },
      body: input,
      signal,
    } satisfies StandardRequest)),
    decodeResponse: vi.fn(async (response) => {
      const body = await response.resolveBody()
      return { kind: 'output' as const, output: body }
    }),
  }
}

function makeTransport(
  resolveBody: StandardLazyResponse['resolveBody'] = vi.fn(async () => ({ value: '__body__' })),
): StandardLinkTransport<TestContext> {
  return {
    send: vi.fn(async () => ({
      status: 200,
      headers: {
        'x-custom': '1',
      },
      resolveBody,
    } satisfies StandardLazyResponse)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('dedupeLinkPlugin', () => {
  const allAbortSignalSpy = vi.spyOn(SharedExperimentalV2Module, 'allAbortSignal')

  it('dedupes identical requests and resolves the body once', async () => {
    const signal1 = AbortSignal.timeout(1000)
    const signal2 = AbortSignal.timeout(1000)
    const codec = makeCodec()
    const resolveBody = vi.fn(async () => ({ value: '__body__' }))
    const transport = makeTransport(resolveBody)
    const groupCondition = vi.fn(() => true)

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{
          condition: groupCondition,
          context: { group: true },
        }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: { tag: 'first' }, signal: signal1 }),
      link.call(['GET', 'planet'], { value: 1 }, { context: { tag: 'second' }, signal: signal2 }),
    ])

    expect(output1).toEqual({ value: '__body__' })
    expect(output2).toEqual({ value: '__body__' })
    expect(output1).not.toBe(output2)

    expect(codec.encodeInput).toHaveBeenCalledTimes(2)
    expect(transport.send).toHaveBeenCalledTimes(1)
    expect(resolveBody).toHaveBeenCalledTimes(1)

    const [request, path, callOptions] = vi.mocked(transport.send).mock.calls[0]!

    expect(request).toEqual({
      ...await vi.mocked(codec.encodeInput).mock.results[0]!.value,
      signal: allAbortSignalSpy.mock.results[0]!.value,
    })
    expect(path).toEqual(['GET', 'planet'])
    expect(callOptions).toMatchObject({
      context: { group: true },
      signal: allAbortSignalSpy.mock.results[0]!.value,
    })
    expect((callOptions as any).next).toEqual(expect.any(Function))

    expect(allAbortSignalSpy).toHaveBeenCalledTimes(1)
    expect(allAbortSignalSpy).toHaveBeenCalledWith([signal1, signal2])

    expect(groupCondition).toHaveBeenCalledTimes(2)
    expect(groupCondition).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: ['GET', 'planet'],
      request: await vi.mocked(codec.encodeInput).mock.results[0]!.value,
      context: { tag: 'first' },
    }))
    expect(groupCondition).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: ['GET', 'planet'],
      request: await vi.mocked(codec.encodeInput).mock.results[1]!.value,
      context: { tag: 'second' },
    }))
  })

  it('dedupes identical QUERY requests by default', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['QUERY', 'planet'], { value: 1 }, { context: {} }),
      link.call(['QUERY', 'planet'], { value: 1 }, { context: {} }),
    ])

    expect(output1).toEqual(output2)
    expect(transport.send).toHaveBeenCalledTimes(1)
  })

  it('does not dedupe QUERY requests with different bodies', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['QUERY', 'planet'], { value: 1 }, { context: {} }),
      link.call(['QUERY', 'planet'], { value: 2 }, { context: {} }),
    ])

    expect(output1).not.toBe(output2)
    expect(transport.send).toHaveBeenCalledTimes(2)
  })

  it('does not dedupe unsafe methods by default', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['POST', 'planet'], { value: 1 }, { context: {} }),
      link.call(['POST', 'planet'], { value: 1 }, { context: {} }),
    ])

    expect(output1).not.toBe(output2)
    expect(transport.send).toHaveBeenCalledTimes(2)
  })

  it('computes group context from all deduped matching options', async () => {
    const codec = makeCodec()
    const transport = makeTransport()
    const context = vi.fn((items: [
      { context: TestContext },
      ...{ context: TestContext }[],
    ]) => ({
      group: true,
      tag: items.map(item => item.context.tag).join(','),
    }))

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{
          condition: () => true,
          context,
        }],
      })],
    })

    await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: { tag: 'first' } }),
      link.call(['GET', 'planet'], { value: 1 }, { context: { tag: 'second' } }),
    ])

    expect(context).toHaveBeenCalledTimes(1)
    expect(context).toHaveBeenCalledWith([
      expect.objectContaining({ context: { tag: 'first' } }),
      expect.objectContaining({ context: { tag: 'second' } }),
    ])

    const [, , callOptions] = vi.mocked(transport.send).mock.calls[0]!

    expect(callOptions).toMatchObject({
      context: { group: true, tag: 'first,second' },
    })
  })

  it('passes through single matching requests without applying dedupe context', async () => {
    const signal = AbortSignal.timeout(1000)
    const codec = makeCodec()
    const transport = makeTransport()
    const context = vi.fn(() => ({
      group: true,
      tag: 'deduped',
    }))

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{
          condition: () => true,
          context,
        }],
      })],
    })

    await link.call(['GET', 'planet'], { value: 1 }, { context: { tag: 'single' }, signal })

    expect(context).not.toHaveBeenCalled()
    expect(transport.send).toHaveBeenCalledTimes(1)

    const [request, path, callOptions] = vi.mocked(transport.send).mock.calls[0]!

    expect(request).toEqual(await vi.mocked(codec.encodeInput).mock.results[0]!.value)
    expect(path).toEqual(['GET', 'planet'])
    expect(callOptions).toMatchObject({
      context: { tag: 'single' },
      signal,
    })
    expect((callOptions as any).next).toEqual(expect.any(Function))
  })

  it('replicates AsyncIteratorObject response bodies for deduped requests', async () => {
    const codec = makeCodec()
    const iteratorFactory = vi.fn(async function* () {
      yield 'first'
      yield 'second'
    })
    const resolveBody = vi.fn(async () => iteratorFactory())
    const transport = makeTransport(resolveBody)

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
    ])

    await expect(readAllAsync(output1 as AsyncIterable<string>)).resolves.toEqual(['first', 'second'])
    await expect(readAllAsync(output2 as AsyncIterable<string>)).resolves.toEqual(['first', 'second'])
    expect(resolveBody).toHaveBeenCalledTimes(1)
  })

  it('replicates readable stream response bodies for deduped requests', async () => {
    const codec = makeCodec()
    const resolveBody = vi.fn(async () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3, 4]))
        controller.close()
      },
    }))
    const transport = makeTransport(resolveBody)

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
    ])

    await expect(readAllStream(output1 as ReadableStream<Uint8Array>)).resolves.toEqual([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ])
    await expect(readAllStream(output2 as ReadableStream<Uint8Array>)).resolves.toEqual([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ])
    expect(resolveBody).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'readable-stream',
      () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          controller.enqueue(new Uint8Array([3, 4]))
          controller.close()
        },
      }),
      (output: unknown) => readAllStream(output as ReadableStream<Uint8Array>),
      [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
    ],
    [
      'async-iterator',
      async function* () {
        yield 'first'
        yield 'second'
      },
      (output: unknown) => readAllAsync(output as AsyncIterable<string>),
      ['first', 'second'],
    ],
  ])('reuses the resolved %s body for repeated and concurrent reads of the same replicated response', async (_name, createBody, readAll, expected) => {
    const codec: StandardLinkCodec<TestContext> = {
      ...makeCodec(),
      decodeResponse: vi.fn(async (response) => {
        const [firstBody, concurrentBody] = await Promise.all([
          response.resolveBody(),
          response.resolveBody(),
        ])
        const laterBody = await response.resolveBody()

        expect(concurrentBody).toBe(firstBody)
        expect(laterBody).toBe(firstBody)

        return {
          kind: 'output' as const,
          output: firstBody,
        }
      }),
    }
    const resolveBody = vi.fn(async () => createBody())
    const transport = makeTransport(resolveBody)

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
    ])

    await expect(readAll(output1)).resolves.toEqual(expected)
    await expect(readAll(output2)).resolves.toEqual(expected)
    expect(resolveBody).toHaveBeenCalledTimes(1)
  })

  it('dedupes non-GET requests when filter allows them', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
        filter: () => true,
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['POST', 'planet'], { value: 1 }, { context: {} }),
      link.call(['POST', 'planet'], { value: 1 }, { context: {} }),
    ])

    expect(output1).toEqual(output2)
    expect(transport.send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['blob', new Blob(['test'])],
    ['form-data', new FormData()],
    ['url-search-params', new URLSearchParams('a=1')],
    ['readable-stream', new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
        controller.close()
      },
    })],
    ['async-iterator', (async function* () { yield 'chunk' }())],
  ])('passes through unsupported %s bodies', async (_name, body) => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
        filter: () => true,
      })],
    })

    await Promise.all([
      link.call(['POST', 'upload'], body, { context: {} }),
      link.call(['POST', 'upload'], body, { context: {} }),
    ])

    expect(transport.send).toHaveBeenCalledTimes(2)
  })

  it('passes through when the request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller.signal }),
      link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller.signal }),
    ])

    expect(transport.send).toHaveBeenCalledTimes(2)
  })

  it('rejects all callers when the request fails', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    vi.mocked(transport.send).mockRejectedValue(new Error('FAIL'))

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => true, context: { group: true } }],
      })],
    })

    const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })
    const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })

    await expect(promise1).rejects.toThrow('FAIL')
    await expect(promise2).rejects.toThrow('FAIL')
    expect(transport.send).toHaveBeenCalledTimes(1)
  })

  it('does not dedupe when no group matches', async () => {
    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        groups: [{ condition: () => false, context: { group: true } }],
      })],
    })

    const [output1, output2] = await Promise.all([
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
      link.call(['GET', 'planet'], { value: 1 }, { context: {} }),
    ])

    expect(output1).not.toBe(output2)
    expect(transport.send).toHaveBeenCalledTimes(2)
  })

  it('dedupes identical requests made within `wait`, counted from the first queued request', async () => {
    vi.useFakeTimers()

    const codec = makeCodec()
    const transport = makeTransport()

    const link = new StandardLink(codec, transport, {
      plugins: [new DedupeLinkPlugin({
        wait: 100,
        groups: [{ condition: () => true, context: {} }],
      })],
    })

    const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })
    await vi.advanceTimersByTimeAsync(60)
    const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })

    await vi.advanceTimersByTimeAsync(39)
    expect(transport.send).toHaveBeenCalledTimes(0)

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise1).resolves.toEqual({ value: '__body__' })
    await expect(promise2).resolves.toEqual({ value: '__body__' })
    expect(transport.send).toHaveBeenCalledTimes(1)

    // A request made after the deduped one is sent starts a new wait
    const promise3 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })

    await vi.advanceTimersByTimeAsync(99)
    expect(transport.send).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await expect(promise3).resolves.toEqual({ value: '__body__' })
    expect(transport.send).toHaveBeenCalledTimes(2)
  })
  describe('isolated outputs', () => {
    function makeLink(resolveBody: StandardLazyResponse['resolveBody']) {
      const codec = makeCodec()
      const transport = makeTransport(vi.fn(resolveBody))

      const link = new StandardLink(codec, transport, {
        plugins: [new DedupeLinkPlugin({
          groups: [{ condition: () => true, context: {} }],
        })],
      })

      return { link, transport }
    }

    it('gives each caller its own copy of the output', async () => {
      const { link, transport } = makeLink(async () => ({ list: [3, 1, 2] }))

      const [output1, output2] = await Promise.all([
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<{ list: number[] }>,
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<{ list: number[] }>,
      ])

      expect(transport.send).toHaveBeenCalledTimes(1)
      expect(output1).not.toBe(output2)

      output1.list.sort()
      output1.list.push(99)

      expect(output1).toEqual({ list: [1, 2, 3, 99] })
      expect(output2).toEqual({ list: [3, 1, 2] })
    })

    it('keeps Blob, File, and primitive values while copying their containers', async () => {
      const blob = new Blob(['blob'])
      const file = new File(['file'], 'file.txt', { type: 'text/plain' })
      const { link } = makeLink(async () => ({ nested: { blob, file, big: 1n, list: [1] } }))

      const [output1, output2] = await Promise.all([
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<any>,
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<any>,
      ])

      expect(output1.nested).not.toBe(output2.nested)
      expect(output1.nested.list).not.toBe(output2.nested.list)

      for (const output of [output1, output2]) {
        expect(output.nested.blob).toBe(blob)
        expect(output.nested.file).toBe(file)
        expect(output.nested.big).toBe(1n)
      }
    })

    it('gives each caller its own FormData and URLSearchParams', async () => {
      const file = new File(['file'], 'file.txt', { type: 'text/plain' })
      const { link } = makeLink(async () => {
        const form = new FormData()
        form.append('a', '1')
        form.append('a', '2')
        form.append('file', file)
        return form
      })

      const [form1, form2] = await Promise.all([
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<FormData>,
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<FormData>,
      ])

      expect(form1).not.toBe(form2)
      form1.delete('a')
      expect(form2.getAll('a')).toEqual(['1', '2'])
      expect(form2.get('file')).toBeInstanceOf(File)
      expect((form2.get('file') as File).name).toBe('file.txt')

      const { link: link2 } = makeLink(async () => new URLSearchParams('a=1&a=2'))

      const [params1, params2] = await Promise.all([
        link2.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<URLSearchParams>,
        link2.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<URLSearchParams>,
      ])

      expect(params1).not.toBe(params2)
      params1.delete('a')
      expect(params2.getAll('a')).toEqual(['1', '2'])
    })

    it('gives each caller its own RPC output, including Date, BigInt, and File values', async () => {
      const file = new File(['file'], 'file.txt', { type: 'text/plain' })
      const codec = new RPCLinkCodec<TestContext>({ method: 'GET' })
      const transport = makeTransport(async () => ({
        json: { list: [3, 1, 2], at: '2026-01-01T00:00:00.000Z', n: '1' },
        meta: [['date', 'at'], ['bigint', 'n']],
      }))

      const link = new StandardLink(codec, transport, {
        plugins: [new DedupeLinkPlugin({
          groups: [{ condition: () => true, context: {} }],
        })],
      })

      const [output1, output2] = await Promise.all([
        link.call(['planet'], { value: 1 }, { context: {} }) as Promise<any>,
        link.call(['planet'], { value: 1 }, { context: {} }) as Promise<any>,
      ])

      expect(transport.send).toHaveBeenCalledTimes(1)
      expect(output1.list).not.toBe(output2.list)
      expect(output1.at).not.toBe(output2.at)

      output1.list.push(99)
      output1.at.setFullYear(2000)

      expect(output2).toEqual({ list: [3, 1, 2], at: new Date('2026-01-01T00:00:00.000Z'), n: 1n })

      vi.mocked(transport.send).mockImplementation(async () => ({
        status: 200,
        headers: {},
        resolveBody: async () => {
          const form = new FormData()
          form.set('data', JSON.stringify({ json: { file: {}, list: [1] }, maps: [['file']] }))
          form.set('0', file)
          return form
        },
      }))

      const [output3, output4] = await Promise.all([
        link.call(['planet'], { value: 2 }, { context: {} }) as Promise<any>,
        link.call(['planet'], { value: 2 }, { context: {} }) as Promise<any>,
      ])

      expect(output3.list).not.toBe(output4.list)

      for (const output of [output3, output4]) {
        expect(output.file).toBeInstanceOf(File)
        expect(output.file.name).toBe('file.txt')
        await expect(output.file.text()).resolves.toBe('file')
      }
    })

    it('gives each caller its own copy of every async iterator event, keeping event meta', async () => {
      const { link } = makeLink(async () => (async function* () {
        yield withEventMeta({ list: [3, 1, 2] }, { id: '1', retry: 100 })
        yield 'primitive'
        throw withEventMeta(new ErrorEvent({ list: [1] }, { message: 'event error' }), { id: '2' })
      })())

      const [iterator1, iterator2] = await Promise.all([
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<AsyncIterator<any>>,
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<AsyncIterator<any>>,
      ])

      // The first caller reads and mutates everything before the second caller reads anything.
      const { value: event1 } = await iterator1.next()
      event1.list.push(99)
      await expect(iterator1.next()).resolves.toEqual({ done: false, value: 'primitive' })
      const error1 = await iterator1.next().catch(e => e)
      error1.data.list.push(99)

      const { value: event2 } = await iterator2.next()
      expect(event2).not.toBe(event1)
      expect(event2).toEqual({ list: [3, 1, 2] })
      expect(getEventMeta(event1)).toEqual({ id: '1', retry: 100 })
      expect(getEventMeta(event2)).toEqual({ id: '1', retry: 100 })

      await expect(iterator2.next()).resolves.toEqual({ done: false, value: 'primitive' })

      const error2 = await iterator2.next().catch(e => e)
      expect(error2).not.toBe(error1)
      expect(error2).toBeInstanceOf(ErrorEvent)
      expect(error2.message).toBe('event error')
      expect(error2.data).toEqual({ list: [1] })
      expect(getEventMeta(error2)).toEqual({ id: '2' })
    })
  })

  describe('per-caller abort', () => {
    function makeDelayedLink(options: { sendDelay?: number, resolveBody?: StandardLazyResponse['resolveBody'] } = {}) {
      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        if (options.sendDelay) {
          await sleep(options.sendDelay)
        }

        return { status: 200, headers: {}, resolveBody: options.resolveBody ?? (async () => 'ok') }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [new DedupeLinkPlugin({
          groups: [{ condition: () => true, context: {} }],
        })],
      })

      return { link, transport }
    }

    it('rejects an aborted caller with its reason while the shared request keeps running for the others', async () => {
      vi.useFakeTimers()

      const { link, transport } = makeDelayedLink({ sendDelay: 100 })
      const controller1 = new AbortController()
      const controller2 = new AbortController()

      const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller1.signal })
      const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller2.signal })
      const promise3 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })

      await vi.advanceTimersByTimeAsync(20)
      expect(transport.send).toHaveBeenCalledTimes(1)
      const sharedSignal = vi.mocked(transport.send).mock.calls[0]![0].signal

      const reason = new Error('first caller aborted')
      controller1.abort(reason)
      await expect(promise1).rejects.toBe(reason)
      expect(sharedSignal?.aborted ?? false).toBe(false)

      await vi.advanceTimersByTimeAsync(80)
      await expect(promise2).resolves.toBe('ok')
      await expect(promise3).resolves.toBe('ok')
      expect(transport.send).toHaveBeenCalledTimes(1)
    })

    it('aborts the shared request only after every caller aborts', async () => {
      vi.useFakeTimers()

      const { link, transport } = makeDelayedLink({ sendDelay: 100 })
      const controller1 = new AbortController()
      const controller2 = new AbortController()

      const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller1.signal })
      const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller2.signal })

      await vi.advanceTimersByTimeAsync(20)
      const sharedSignal = vi.mocked(transport.send).mock.calls[0]![0].signal!

      controller1.abort(new Error('first'))
      await expect(promise1).rejects.toThrow('first')
      expect(sharedSignal.aborted).toBe(false)

      controller2.abort(new Error('second'))
      await expect(promise2).rejects.toThrow('second')
      expect(sharedSignal.aborted).toBe(true)
    })

    it('honors TimeoutLinkPlugin for each caller', async () => {
      vi.useFakeTimers()

      const codec = makeCodec()
      const transport = makeTransport()

      vi.mocked(transport.send).mockImplementation(async () => {
        await sleep(100)
        return { status: 200, headers: {}, resolveBody: async () => 'ok' }
      })

      const link = new StandardLink(codec, transport, {
        plugins: [
          new TimeoutLinkPlugin({ timeout: ({ context }) => context.tag === 'timeout' ? 20 : undefined }),
          new DedupeLinkPlugin({ groups: [{ condition: () => true, context: {} }] }),
        ],
      })

      const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: { tag: 'timeout' } })
      const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })
      const assertion1 = expect(promise1).rejects.toSatisfy(error =>
        error instanceof AbortError && error.message === 'Request timed out after 20ms',
      )

      await vi.advanceTimersByTimeAsync(20)
      await assertion1

      await vi.advanceTimersByTimeAsync(80)
      await expect(promise2).resolves.toBe('ok')
      expect(transport.send).toHaveBeenCalledTimes(1)
    })

    it('rejects a caller that aborts while its body is resolving', async () => {
      vi.useFakeTimers()

      const { link } = makeDelayedLink({
        resolveBody: async () => {
          await sleep(100)
          return 'ok'
        },
      })
      const controller = new AbortController()

      const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller.signal })
      const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {} })

      await vi.advanceTimersByTimeAsync(20)

      const reason = new Error('aborted')
      controller.abort(reason)
      await expect(promise1).rejects.toBe(reason)

      await vi.advanceTimersByTimeAsync(100)
      await expect(promise2).resolves.toBe('ok')
    })

    it('stops an aborted caller\'s async iterator and releases its share of the source', async () => {
      vi.useFakeTimers()

      const cleanup = vi.fn()
      let counter = 0
      const { link } = makeDelayedLink({
        resolveBody: async () => new AsyncIteratorClass(async () => {
          await sleep(10)
          return { done: false, value: counter++ }
        }, cleanup),
      })
      const controller = new AbortController()

      const promise = Promise.all([
        link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller.signal }) as Promise<AsyncIterator<number>>,
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<AsyncIterator<number>>,
      ])
      await vi.advanceTimersByTimeAsync(1)
      const [iterator1, iterator2] = await promise

      const next1 = iterator1.next()
      const next2 = iterator2.next()
      await vi.advanceTimersByTimeAsync(10)
      await expect(next1).resolves.toEqual({ done: false, value: 0 })
      await expect(next2).resolves.toEqual({ done: false, value: 0 })

      const pending1 = iterator1.next()
      const reason = new Error('aborted')
      controller.abort(reason)
      await expect(pending1).rejects.toBe(reason)
      await expect(iterator1.next()).resolves.toEqual({ done: true, value: undefined })

      await vi.advanceTimersByTimeAsync(10)
      await expect(iterator2.next()).resolves.toEqual({ done: false, value: 1 })
      expect(cleanup).not.toHaveBeenCalled()

      await iterator2.return!()
      expect(cleanup).toHaveBeenCalledTimes(1)
    })

    it('stops an aborted caller\'s readable stream and releases its share of the source', async () => {
      vi.useFakeTimers()

      const cancel = vi.fn()
      let counter = 0
      const { link } = makeDelayedLink({
        resolveBody: async () => new ReadableStream<number>({
          async pull(controller) {
            await sleep(10)
            controller.enqueue(counter++)
          },
          cancel,
        }),
      })
      const controller = new AbortController()

      const promise = Promise.all([
        link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller.signal }) as Promise<ReadableStream<number>>,
        link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<ReadableStream<number>>,
      ])
      await vi.advanceTimersByTimeAsync(1)
      const [stream1, stream2] = await promise
      const reader1 = stream1.getReader()
      const reader2 = stream2.getReader()

      const read1 = reader1.read()
      const read2 = reader2.read()
      await vi.advanceTimersByTimeAsync(10)
      await expect(read1).resolves.toEqual({ done: false, value: 0 })
      await expect(read2).resolves.toEqual({ done: false, value: 0 })

      const pending1 = reader1.read()
      const reason = new Error('aborted')
      controller.abort(reason)
      await expect(pending1).rejects.toBe(reason)

      await vi.advanceTimersByTimeAsync(10)
      await expect(reader2.read()).resolves.toEqual({ done: false, value: 1 })
      expect(cancel).not.toHaveBeenCalled()

      await reader2.cancel('done')
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it.each(['before the response', 'while the body resolves'] as const)(
      'releases the share of a caller that aborts %s',
      async (when) => {
        vi.useFakeTimers()

        const cleanup = vi.fn()
        const { link } = makeDelayedLink({
          sendDelay: when === 'before the response' ? 100 : 0,
          resolveBody: async () => {
            await sleep(when === 'while the body resolves' ? 100 : 0)
            return new AsyncIteratorClass(async () => {
              await sleep(10)
              return { done: false, value: 'event' }
            }, cleanup)
          },
        })
        const controller = new AbortController()

        const promise1 = link.call(['GET', 'planet'], { value: 1 }, { context: {}, signal: controller.signal })
        const promise2 = link.call(['GET', 'planet'], { value: 1 }, { context: {} }) as Promise<AsyncIterator<string>>

        await vi.advanceTimersByTimeAsync(20)
        controller.abort(new Error('aborted'))
        await expect(promise1).rejects.toThrow('aborted')

        await vi.advanceTimersByTimeAsync(100)
        const iterator2 = await promise2
        const next2 = iterator2.next()
        await vi.advanceTimersByTimeAsync(10)
        await expect(next2).resolves.toEqual({ done: false, value: 'event' })

        await iterator2.return!()
        expect(cleanup).toHaveBeenCalledTimes(1)
      },
    )
  })
})

async function readAllAsync<T>(iterator: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []

  for await (const value of iterator) {
    values.push(value)
  }

  return values
}

async function readAllStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const values: T[] = []

  try {
    while (true) {
      const result = await reader.read()

      if (result.done) {
        return values
      }

      values.push(result.value)
    }
  }
  finally {
    reader.releaseLock()
  }
}
