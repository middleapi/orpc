import { ORPCError } from '@orpc/client'
import * as v from 'valibot'
import { RPCHandler } from './adapters/fetch'
import { os } from './builder'

describe('input validation issues sent to the client', () => {
  const records: Record<string, { id: string, email: string, passwordHash: string }> = {
    u1: { id: 'u1', email: 'victim@example.com', passwordHash: '$argon2id$SECRET' },
  }

  async function call(router: any, json: unknown) {
    const handler = new RPCHandler(router)
    const { response } = await handler.handle(new Request('http://localhost/proc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json }),
    }))
    return { status: response!.status, text: await response!.text() }
  }

  it('does not echo values produced by an earlier stacked schema transform', async () => {
    const authorize = vi.fn(() => {
      throw new ORPCError('FORBIDDEN')
    })
    const proc = os
      .input(v.object({ userId: v.pipe(v.string(), v.transform(id => records[id])) }))
      .input(v.object({ amount: v.number() }))
      .use(async () => authorize())
      .handler(() => 'ok')

    const { status, text } = await call({ proc }, { userId: 'u1', amount: 'x' })

    expect(status).toBe(400)
    expect(authorize).not.toHaveBeenCalled()
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain('victim@example.com')
    expect(JSON.parse(text).json.data.issues).toEqual([
      { message: expect.any(String), path: ['amount'] },
    ])
  })

  it('does not echo transformed values from a post-transform check in a single schema', async () => {
    const proc = os
      .input(v.pipe(
        v.object({ userId: v.pipe(v.string(), v.transform(id => records[id])), amount: v.number() }),
        v.forward(v.check(i => i.amount > 0, 'amount must be positive'), ['amount']),
      ))
      .handler(() => 'ok')

    const { status, text } = await call({ proc }, { userId: 'u1', amount: -1 })

    expect(status).toBe(400)
    expect(text).not.toContain('SECRET')
    expect(JSON.parse(text).json.data.issues).toEqual([
      { message: 'amount must be positive', path: ['amount'] },
    ])
  })

  it('keeps raw library issues on the server-side cause', async () => {
    const proc = os.input(v.object({ amount: v.number() })).handler(() => 'ok')
    const handler = new RPCHandler({ proc }, {
      clientInterceptors: [async ({ next }) => {
        try {
          return await next()
        }
        catch (e: any) {
          expect(e.cause.issues[0]).toMatchObject({ kind: 'schema', input: 'x' })
          throw e
        }
      }],
    })
    const { response } = await handler.handle(new Request('http://localhost/proc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { amount: 'x' } }),
    }))
    expect(response!.status).toBe(400)
  })
})
