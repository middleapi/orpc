import type { StandardRequest } from '@orpc/standard-server'
import type { RouterClient } from '../../../server/src/router-client'
import { isAsyncIteratorObject } from '@orpc/shared'
import { toBatchResponse } from '@orpc/standard-server/batch'
import * as StandardBatchModule from '@orpc/standard-server/batch'
import { RPCHandler } from '../../../server/src/adapters/fetch/rpc-handler'
import { os } from '../../../server/src/builder'
import { BatchHandlerPlugin } from '../../../server/src/plugins/batch'
import { RPCLink } from '../adapters/fetch'
import { StandardLink } from '../adapters/standard'
import { createORPCClient } from '../client'
import { ORPCError } from '../error'
import { BatchLinkPlugin } from './batch'

const toBatchRequestSpy = vi.spyOn(StandardBatchModule, 'toBatchRequest')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('batchLinkPlugin', () => {
  const signal = AbortSignal.timeout(1000)

  const clientCall = vi.fn(async (request) => {
    const response = toBatchResponse({
      status: 200,
      headers: {},
      body: (async function* () {
        yield { index: 0, status: 200, headers: { 'x-custom': '1' }, body: 'yielded1' }
        yield { index: 1, status: 201, headers: { 'x-custom': '2' }, body: 'yielded2' }
      })(),

    })

    return { ...response, body: () => Promise.resolve(response.body) }
  })

  const groupCondition = vi.fn(() => true)

  const encode = vi.fn(async (path, input, { signal }): Promise<StandardRequest> => ({
    url: new URL(`http://localhost/prefix/${path.join('/')}`),
    method: path[0] as any,
    headers: {
      bearer: '123',
      path,
    },
    body: input,
    signal,
  }))

  const decode = vi.fn(async (response): Promise<unknown> => response.body())

  const link = new StandardLink({ encode, decode }, { call: clientCall }, {
    plugins: [new BatchLinkPlugin({
      groups: [{
        condition: groupCondition,
        context: { group: true } as any,
        input: '__group__',
        path: ['__group__'],
      }],
    })],
  })

  it.each(['POST', 'GET'])('batch request with POST', async (method) => {
    const [output1, output2] = await Promise.all([
      link.call([method, 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call([method, 'bar'], '__bar__', { context: { bar: true } }),
    ])

    expect(output1).toEqual('yielded1')
    expect(output2).toEqual('yielded2')

    expect(encode).toHaveBeenCalledTimes(2)

    const request1 = await encode.mock.results[0]!.value
    const request2 = await encode.mock.results[1]!.value

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(1)
    expect(toBatchRequestSpy).toHaveBeenCalledWith({
      url: new URL(`http://localhost/prefix/${method}/foo/__batch__`),
      method,
      headers: {
        bearer: '123',
      },
      requests: [
        {
          ...request1,
          headers: {
            ...request1.headers,
            bearer: undefined,
          },
        },
        {
          ...request2,
          headers: {
            ...request2.headers,
            bearer: undefined,
          },
        },
      ],
    })

    expect(clientCall).toHaveBeenCalledTimes(1)
    expect(clientCall).toHaveBeenCalledWith(
      {
        ...toBatchRequestSpy.mock.results[0]!.value,
        headers: {
          ...toBatchRequestSpy.mock.results[0]!.value.headers,
          'x-orpc-batch': '1',
        },
      },
      { context: { group: true }, signal: toBatchRequestSpy.mock.results[0]!.value.signal },
      ['__group__'],
      '__group__',
    )
  })

  it('not batch on single request', async () => {
    const [output1] = await Promise.all([
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
    ])

    expect(output1).toSatisfy(isAsyncIteratorObject)

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(0)
    expect(clientCall).toHaveBeenCalledTimes(1)

    const request = await encode.mock.results[0]!.value

    expect(clientCall).toHaveBeenCalledWith(
      request,
      { context: { foo: true }, signal },
      ['POST', 'foo'],
      '__foo__',
    )
  })

  it.each([new FormData(), (async function* () {})()])('not batch on un-supported body', async (body) => {
    encode.mockResolvedValueOnce({
      body,
      headers: {
        'x-custom': '1',
      },
      method: 'POST',
      signal,
      url: new URL(`http://some.url/prefix/foo`),
    })

    const [output1] = await Promise.all([
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
    ])

    expect(output1).toSatisfy(isAsyncIteratorObject)

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(0)
    expect(clientCall).toHaveBeenCalledTimes(1)

    const request = await encode.mock.results[0]!.value

    expect(clientCall).toHaveBeenCalledWith(
      request,
      { context: { foo: true }, signal },
      ['POST', 'foo'],
      '__foo__',
    )
  })

  it('not batch when no group is matched', async () => {
    groupCondition.mockReturnValueOnce(false)

    const [output1, output2] = await Promise.all([
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['POST', 'bar'], '__bar__', { context: { bar: true } }),
    ])

    expect(output1).toSatisfy(isAsyncIteratorObject)
    expect(output2).toSatisfy(isAsyncIteratorObject)

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(0)
    expect(clientCall).toHaveBeenCalledTimes(2)

    const request1 = await encode.mock.results[0]!.value

    expect(clientCall).toHaveBeenNthCalledWith(
      1,
      request1,
      { context: { foo: true }, signal },
      ['POST', 'foo'],
      '__foo__',
    )

    const request2 = await encode.mock.results[1]!.value

    expect(clientCall).toHaveBeenNthCalledWith(
      2,
      request2,
      { context: { bar: true } },
      ['POST', 'bar'],
      '__bar__',
    )
  })

  it('throw on invalid batch response', async () => {
    clientCall.mockResolvedValueOnce({
      body: async () => 'invalid',
      headers: {},
      status: 404,
    })

    await expect(
      Promise.all([
        link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
        link.call(['POST', 'bar'], '__bar__', { context: { bar: true } }),
      ]),
    ).rejects.toThrow('Invalid batch response')

    expect(clientCall).toBeCalledTimes(1)
    expect(toBatchRequestSpy).toBeCalledTimes(1)
  })

  it('separate GET and non-GET requests', async () => {
    const [output11, output12, output21, output22] = await Promise.all([
      link.call(['GET', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['GET', 'bar'], '__bar__', { context: { bar: true } }),
      link.call(['POST', 'bar'], '__bar__', { context: { bar: true } }),
    ])

    expect(output11).toEqual('yielded1')
    expect(output21).toEqual('yielded2')
    expect(output12).toEqual('yielded1')
    expect(output22).toEqual('yielded2')

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(2)
  })

  it('split in half when exeeding max batch size', async () => {
    const link = new StandardLink({ encode, decode }, { call: clientCall }, {
      plugins: [new BatchLinkPlugin({
        groups: [{
          condition: groupCondition,
          context: { group: true } as any,
          input: '__group__',
          path: ['__group__'],
        }],
        maxSize: 2,
      })],
    })

    const [output11, output12, output21, output22] = await Promise.all([
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['POST', 'bar'], '__bar__', { context: { bar: true } }),
      link.call(['POST', 'bar'], '__bar__', { context: { bar: true } }),
    ])

    expect(output11).toEqual('yielded1')
    expect(output21).toEqual('yielded1')
    expect(output12).toEqual('yielded2')
    expect(output22).toEqual('yielded2')

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(2)
  })

  it('split in half when url exceeds max url length', async () => {
    const link = new StandardLink({ encode, decode }, { call: clientCall }, {
      plugins: [new BatchLinkPlugin({
        groups: [{
          condition: groupCondition,
          context: { group: true } as any,
          input: '__group__',
          path: ['__group__'],
        }],
        maxUrlLength: 500,
      })],
    })

    const [output11, output12, output21, output22] = await Promise.all([
      link.call(['GET', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['GET', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['GET', 'bar'], '__bar__', { context: { bar: true } }),
      link.call(['GET', 'bar'], '__bar__', { context: { bar: true } }),
    ])

    expect(output11).toEqual('yielded1')
    expect(output21).toEqual('yielded1')
    expect(output12).toEqual('yielded2')
    expect(output22).toEqual('yielded2')

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(3)
  })

  it('silence remove x-orpc-batch=1 header', async () => {
    encode.mockResolvedValueOnce({
      body: async () => 'something',
      headers: {
        'x-custom': '1',
        'x-orpc-batch': '1',
      },
      method: 'POST',
      signal,
      url: new URL(`http://some.url/prefix/foo`),
    })

    await link.call(['POST', 'foo'], '__foo__', { context: {} })

    expect(clientCall).toHaveBeenCalledTimes(1)

    const request = clientCall.mock.calls[0]![0]

    expect(request.headers).toEqual({
      'x-custom': '1',
    })
  })

  it('can exclude a request from the batch', async () => {
    const exclude = vi.fn(({ request }) => request.url.pathname.endsWith('bar1'))

    const link = new StandardLink({ encode, decode }, { call: clientCall }, {
      plugins: [new BatchLinkPlugin({
        groups: [{
          condition: groupCondition,
          context: { group: true } as any,
          input: '__group__',
          path: ['__group__'],
        }],
        exclude,
      })],
    })

    const [output1, output2, output3] = await Promise.all([
      link.call(['POST', 'foo'], '__foo__', { context: { foo: true }, signal }),
      link.call(['POST', 'bar1'], '__bar1__', { context: { bar: true } }),
      link.call(['POST', 'bar2'], '__bar2__', { context: { bar: true } }),
    ])

    expect(output1).toEqual('yielded1')
    expect(output3).toEqual('yielded2')
    expect(output2).toSatisfy(isAsyncIteratorObject)

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(1)
    expect(clientCall).toHaveBeenCalledTimes(2)

    expect(exclude).toHaveBeenCalledTimes(3)
  })

  it('should throw error when the responses is missing', async () => {
    const first = link.call(['GET', 'foo'], '__foo__', { context: { foo: true }, signal })
    const second = link.call(['GET', 'foo'], '__foo__', { context: { foo: true }, signal })

    await expect(
      link.call(['GET', 'bar'], '__bar__', { context: { bar: true } }),
    ).rejects.toThrow('Something went wrong make batch response not contains enough responses. This can be a bug please report it.')

    expect(toBatchRequestSpy).toHaveBeenCalledTimes(1)

    expect(await first).toEqual('yielded1')
    expect(await second).toEqual('yielded2')
  })
})

describe('batchLinkPlugin + batchHandlerPlugin', () => {
  const router = {
    success: os.handler(({ input }) => ({ output: input })),
    error: os.handler(({ input }) => {
      throw new ORPCError('TEST', { data: input })
    }),
  }

  const handler = new RPCHandler(router, {
    plugins: [
      new BatchHandlerPlugin(),
    ],
  })

  const fetch = vi.fn(async (request) => {
    const { response } = await handler.handle(request, {
      prefix: '/prefix',
    })

    return response ?? Promise.reject(new Error('No response'))
  })

  const link = new RPCLink({
    url: 'http://localhost/prefix',
    fetch,
    plugins: [
      new BatchLinkPlugin({
        groups: [{
          condition: () => true,
          context: {},
        }],
      }),
    ],
  })

  const client: RouterClient<typeof router> = createORPCClient(link)

  it('on success', async () => {
    const [output1, output2] = await Promise.all([
      client.success('success1'),
      client.success('success2'),
    ])

    expect(output1).toEqual({ output: 'success1' })
    expect(output2).toEqual({ output: 'success2' })

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('on error', async () => {
    await expect(
      Promise.all([
        client.error('success1'),
        client.error('success2'),
      ]),
    ).rejects.toThrow('TEST')

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
