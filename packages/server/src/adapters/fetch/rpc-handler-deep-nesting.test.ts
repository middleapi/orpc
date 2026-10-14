import type { Schema } from '@orpc/contract'
import { ORPCError } from '@orpc/client'
import { os } from '../../builder'
import { RPCHandler } from './rpc-handler'

const nested = (depth: number) => '['.repeat(depth) + ']'.repeat(depth)

/** Like Valibot: every issue carries the raw, client-controlled input. */
const valibotLike: Schema<{ name: string }> = {
  '~standard': { version: 1, vendor: 'valibot-like', validate: value => ({ issues: [{ message: 'Invalid type', path: ['name'], input: (value as any)?.name } as any] }) },
}
/** Like ArkType's ArkError: a class instance, so the serializer passes it through and JSON.stringify calls toJSON. */
class IssueLike {
  constructor(readonly data: unknown) {}
  toJSON() { return { message: 'must be a string', path: ['name'], data: this.data } }
}
const arktypeLike: Schema<{ name: string }> = {
  '~standard': { version: 1, vendor: 'arktype-like', validate: value => ({ issues: [new IssueLike((value as any)?.name) as any] }) },
}
class Unserializable {
  toJSON(): never { throw new Error('not serializable') }
}

describe('rpcHandler: error responses with deeply nested or unserializable data', () => {
  const DEPTH = 10_000 // ~20 KB request body
  const handler = new RPCHandler({
    valibotLike: os.input(valibotLike).handler(() => 'ok'),
    arktypeLike: os.input(arktypeLike).handler(() => 'ok'),
    // No validator: a client-sent `event: error` is re-thrown as an ORPCError with client-controlled data.
    stream: os.handler(async ({ input }) => {
      for await (const _ of input as AsyncIterable<unknown>) {
        // consume
      }
      return 'done'
    }),
    unserializable: os.handler(() => {
      throw new ORPCError('BAD_REQUEST', { data: new Unserializable() })
    }),
    deepOutput: os.handler(() => JSON.parse(nested(DEPTH))),
  })
  const post = (path: string, contentType: string, body: string) => handler.handle(new Request(`http://localhost/${path}`, { method: 'POST', headers: { 'content-type': contentType }, body }))

  it.each(['valibotLike', 'arktypeLike'])('%s: deeply nested invalid input yields an error response', async (name) => {
    const result = await post(name, 'application/json', `{"json":{"name":${nested(DEPTH)}}}`)
    expect(result.matched).toBe(true)
    expect(result.response!.status).toBeGreaterThanOrEqual(400)
    await expect(result.response!.text()).resolves.toBeTypeOf('string')
  })

  it('client-sent `event: error` with deeply nested data yields an error response', async () => {
    const data = `{"json":{"defined":false,"code":"BAD_REQUEST","message":"x","data":${nested(DEPTH)}}}`
    const result = await post('stream', 'text/event-stream', `event: error\ndata: ${data}\n\n`)
    expect(result.matched).toBe(true)
    expect(result.response!.status).toBeGreaterThanOrEqual(400)
    await expect(result.response!.text()).resolves.toBeTypeOf('string')
  })

  it('deeply nested output yields an INTERNAL_SERVER_ERROR response', async () => {
    const result = await post('deepOutput', 'application/json', '{"json":null}')
    expect(result.matched).toBe(true)
    expect(result.response!.status).toBe(500)
    await expect(result.response!.json()).resolves.toEqual({
      json: { defined: false, code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' },
    })
  })

  it('error data that JSON.stringify cannot encode yields a 500 instead of rejecting', async () => {
    const result = await post('unserializable', 'application/json', '{"json":null}')
    expect(result.matched).toBe(true)
    expect(result.response!.status).toBe(500)
  })
})
