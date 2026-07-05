import type { StandardLazyResponse, StandardRequest } from '@standardserver/core'
import type { StandardLinkCodec, StandardLinkTransport } from '../adapters/standard'
import * as SharedExperimentalV2Module from '@orpc/shared'
import { StandardLink } from '../adapters/standard'
import { DedupeLinkPlugin } from './dedupe'

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
})

describe('dedupeLinkPlugin', () => {
  const allAbortSignalSpy = vi.spyOn(SharedExperimentalV2Module, 'allAbortSignal')

  it('dedupes identical requests and reuses the resolved body', async () => {
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
    expect(output1).toBe(output2)

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

  it('reuses the resolved body for repeated reads of the same replicated response', async () => {
    const codec: StandardLinkCodec<TestContext> = {
      ...makeCodec(),
      decodeResponse: vi.fn(async (response) => {
        const firstBody = await response.resolveBody()
        const secondBody = await response.resolveBody()

        expect(secondBody).toBe(firstBody)

        return {
          kind: 'output' as const,
          output: secondBody,
        }
      }),
    }
    const resolveBody = vi.fn(async () => new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2]))
      controller.enqueue(new Uint8Array([3, 4]))
      controller.close()
    } }))
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

    expect(output1).toBe(output2)
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
