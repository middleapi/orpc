import { createHandler, notified, post } from './fixtures'

/**
 * An example of the JSON-RPC 2.0 specification (https://www.jsonrpc.org/specification#examples),
 * with the request (`-->`) and the response (`<--`) copied verbatim.
 */
interface SpecVector {
  title: string
  request: string
  /**
   * `undefined` when nothing is returned.
   */
  response: string | undefined
  /**
   * The HTTP status with `errorResponseStatus: 'mapped'`, when the response is a single error.
   */
  mappedStatus?: number
}

/**
 * The examples answered exactly as the specification shows.
 */
const VECTORS: SpecVector[] = [
  {
    title: 'rpc call with named parameters',
    request: '{"jsonrpc": "2.0", "method": "subtract", "params": {"subtrahend": 23, "minuend": 42}, "id": 3}',
    response: '{"jsonrpc": "2.0", "result": 19, "id": 3}',
  },
  {
    title: 'rpc call with named parameters (reordered)',
    request: '{"jsonrpc": "2.0", "method": "subtract", "params": {"minuend": 42, "subtrahend": 23}, "id": 4}',
    response: '{"jsonrpc": "2.0", "result": 19, "id": 4}',
  },
  {
    title: 'a Notification',
    request: '{"jsonrpc": "2.0", "method": "update", "params": [1,2,3,4,5]}',
    response: undefined,
  },
  {
    title: 'a Notification of a non-existent method',
    request: '{"jsonrpc": "2.0", "method": "foobar"}',
    response: undefined,
  },
  {
    title: 'rpc call of non-existent method',
    request: '{"jsonrpc": "2.0", "method": "foobar", "id": "1"}',
    response: '{"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}, "id": "1"}',
    mappedStatus: 404,
  },
  {
    title: 'rpc call with invalid JSON',
    request: '{"jsonrpc": "2.0", "method": "foobar, "params": "bar", "baz]',
    response: '{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": null}',
    mappedStatus: 400,
  },
  {
    title: 'rpc call with invalid Request object',
    request: '{"jsonrpc": "2.0", "method": 1, "params": "bar"}',
    response: '{"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null}',
    mappedStatus: 400,
  },
  {
    title: 'rpc call Batch, invalid JSON',
    request: `[
  {"jsonrpc": "2.0", "method": "sum", "params": [1,2,4], "id": "1"},
  {"jsonrpc": "2.0", "method"
]`,
    response: '{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": null}',
    mappedStatus: 400,
  },
  {
    title: 'rpc call with an empty Array',
    request: '[]',
    response: '{"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null}',
    mappedStatus: 400,
  },
  {
    title: 'rpc call with an invalid Batch (but not empty)',
    request: '[1]',
    response: `[
  {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null}
]`,
  },
  {
    title: 'rpc call with invalid Batch',
    request: '[1,2,3]',
    response: `[
  {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null},
  {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null},
  {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null}
]`,
  },
  {
    title: 'rpc call Batch (all notifications)',
    request: `[
        {"jsonrpc": "2.0", "method": "notify_sum", "params": [1,2,4]},
        {"jsonrpc": "2.0", "method": "notify_hello", "params": [7]}
    ]`,
    response: undefined,
  },
]

/**
 * The examples that pass several positional params. `OpenRPCHandler` maps params to a single procedure input,
 * so it answers them with "Invalid params" (a documented limitation).
 */
const MULTI_POSITIONAL_VECTORS: SpecVector[] = [
  {
    title: 'rpc call with positional parameters',
    request: '{"jsonrpc": "2.0", "method": "subtract", "params": [42, 23], "id": 1}',
    response: '{"jsonrpc": "2.0", "error": {"code": -32602, "message": "Invalid params: expected at most 1 positional parameter, received 2.", "data": {"code": "BAD_REQUEST", "defined": false}}, "id": 1}',
    mappedStatus: 400,
  },
  {
    title: 'rpc call with positional parameters (swapped)',
    request: '{"jsonrpc": "2.0", "method": "subtract", "params": [23, 42], "id": 2}',
    response: '{"jsonrpc": "2.0", "error": {"code": -32602, "message": "Invalid params: expected at most 1 positional parameter, received 2.", "data": {"code": "BAD_REQUEST", "defined": false}}, "id": 2}',
    mappedStatus: 400,
  },
  {
    title: 'rpc call Batch',
    request: `[
        {"jsonrpc": "2.0", "method": "sum", "params": [1,2,4], "id": "1"},
        {"jsonrpc": "2.0", "method": "notify_hello", "params": [7]},
        {"jsonrpc": "2.0", "method": "subtract", "params": [42,23], "id": "2"},
        {"foo": "boo"},
        {"jsonrpc": "2.0", "method": "foo.get", "params": {"name": "myself"}, "id": "5"},
        {"jsonrpc": "2.0", "method": "get_data", "id": "9"}
    ]`,
    response: `[
        {"jsonrpc": "2.0", "error": {"code": -32602, "message": "Invalid params: expected at most 1 positional parameter, received 3.", "data": {"code": "BAD_REQUEST", "defined": false}}, "id": "1"},
        {"jsonrpc": "2.0", "error": {"code": -32602, "message": "Invalid params: expected at most 1 positional parameter, received 2.", "data": {"code": "BAD_REQUEST", "defined": false}}, "id": "2"},
        {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null},
        {"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}, "id": "5"},
        {"jsonrpc": "2.0", "result": ["hello", 5], "id": "9"}
    ]`,
  },
]

/**
 * The multi-positional examples with their params passed as the single input the procedures take:
 * answered with the results of the specification.
 */
const SINGLE_INPUT_VECTORS: SpecVector[] = [
  {
    title: 'rpc call with positional parameters',
    request: '{"jsonrpc": "2.0", "method": "subtract", "params": [{"minuend": 42, "subtrahend": 23}], "id": 1}',
    response: '{"jsonrpc": "2.0", "result": 19, "id": 1}',
  },
  {
    title: 'rpc call with positional parameters (swapped)',
    request: '{"jsonrpc": "2.0", "method": "subtract", "params": [{"minuend": 23, "subtrahend": 42}], "id": 2}',
    response: '{"jsonrpc": "2.0", "result": -19, "id": 2}',
  },
  {
    title: 'a Notification',
    request: '{"jsonrpc": "2.0", "method": "update", "params": [[1,2,3,4,5]]}',
    response: undefined,
  },
  {
    title: 'rpc call Batch',
    request: `[
        {"jsonrpc": "2.0", "method": "sum", "params": [[1,2,4]], "id": "1"},
        {"jsonrpc": "2.0", "method": "notify_hello", "params": [7]},
        {"jsonrpc": "2.0", "method": "subtract", "params": {"minuend": 42, "subtrahend": 23}, "id": "2"},
        {"foo": "boo"},
        {"jsonrpc": "2.0", "method": "foo.get", "params": {"name": "myself"}, "id": "5"},
        {"jsonrpc": "2.0", "method": "get_data", "id": "9"}
    ]`,
    response: `[
        {"jsonrpc": "2.0", "result": 7, "id": "1"},
        {"jsonrpc": "2.0", "result": 19, "id": "2"},
        {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid Request"}, "id": null},
        {"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}, "id": "5"},
        {"jsonrpc": "2.0", "result": ["hello", 5], "id": "9"}
    ]`,
  },
  {
    title: 'rpc call Batch (all notifications)',
    request: `[
        {"jsonrpc": "2.0", "method": "notify_sum", "params": [[1,2,4]]},
        {"jsonrpc": "2.0", "method": "notify_hello", "params": [7]}
    ]`,
    response: undefined,
  },
]

describe.each(['always-200', 'mapped'] as const)('specification examples of JSON-RPC 2.0 (errorResponseStatus: %s)', (errorResponseStatus) => {
  const handler = createHandler({ errorResponseStatus })

  async function expectAnswer(vector: SpecVector): Promise<void> {
    const { status, contentType, body } = await post(handler, vector.request)

    if (vector.response === undefined) {
      expect(status).toBe(204)
      expect(contentType).toBeNull()
      expect(body).toBeUndefined()
      return
    }

    expect(status).toBe(errorResponseStatus === 'mapped' ? vector.mappedStatus ?? 200 : 200)
    expect(contentType).toBe('application/json')
    expect(body).toStrictEqual(JSON.parse(vector.response))
  }

  beforeEach(() => {
    notified.mockClear()
  })

  it.each(VECTORS)('$title', async (vector) => {
    await expectAnswer(vector)
  })

  it('runs the notifications of a batch before answering', async () => {
    await expectAnswer(VECTORS.find(vector => vector.title === 'rpc call Batch (all notifications)')!)

    // `notify_sum` passes several positional params, so it fails silently, see below
    expect(notified).toHaveBeenCalledOnce()
    expect(notified).toHaveBeenCalledWith('notify_hello', 7)
  })

  describe('several positional params (unsupported)', () => {
    it.each(MULTI_POSITIONAL_VECTORS)('$title: answers "Invalid params"', async (vector) => {
      await expectAnswer(vector)
    })

    it('drops a notification with several positional params without calling the procedure', async () => {
      await expectAnswer(VECTORS.find(vector => vector.title === 'a Notification')!)

      expect(notified).not.toHaveBeenCalled()
    })

    it.each(SINGLE_INPUT_VECTORS)('$title: answers as the specification with a single input', async (vector) => {
      await expectAnswer(vector)
    })

    it('calls the procedures of single-input notifications', async () => {
      await expectAnswer(SINGLE_INPUT_VECTORS.find(vector => vector.title === 'a Notification')!)
      await expectAnswer(SINGLE_INPUT_VECTORS.find(vector => vector.title === 'rpc call Batch (all notifications)')!)

      expect(notified).toHaveBeenCalledTimes(3)
      expect(notified).toHaveBeenCalledWith('update', [1, 2, 3, 4, 5])
      expect(notified).toHaveBeenCalledWith('notify_sum', [1, 2, 4])
      expect(notified).toHaveBeenCalledWith('notify_hello', 7)
    })
  })
})
