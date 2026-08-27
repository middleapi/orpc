import type { AsyncIteratorClass } from '@orpc/shared'
import { ORPCError } from '@orpc/client'
import { RPCHandler } from '../adapters/fetch/rpc-handler'
import { os } from '../builder'
import { PrototypePollutionProtectionHandlerPlugin } from './prototype-pollution-protection'

function getPlugin() {
  const existingInterceptor = vi.fn()

  const handlerOptions = new PrototypePollutionProtectionHandlerPlugin<any>().init({
    clientInterceptors: [existingInterceptor],
  } as any)

  return {
    interceptor: handlerOptions.clientInterceptors![0]!,
    existingInterceptor,
    handlerOptions,
  }
}

function invokeInterceptor(input: unknown) {
  const nextResult = { output: 'ok' }
  const next = vi.fn().mockResolvedValue(nextResult)
  const { interceptor } = getPlugin()

  const result = (async () => interceptor({ context: {}, input, next } as any))()

  return { result, next, nextResult }
}

async function expectAllowed(input: unknown) {
  const { result, next, nextResult } = invokeInterceptor(input)

  await expect(result).resolves.toBe(nextResult)
  expect(next).toHaveBeenCalledOnce()
}

async function expectBlocked(input: unknown) {
  const { result, next } = invokeInterceptor(input)

  await expect(result).rejects.toSatisfy(error =>
    error instanceof ORPCError
    && error.code === 'BAD_REQUEST'
    && error.message === 'Request blocked by prototype pollution protection.')
  expect(next).not.toHaveBeenCalled()
}

describe('prototypePollutionProtectionHandlerPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registration', () => {
    it('prepends its client interceptor so it runs before existing ones', () => {
      const { handlerOptions, existingInterceptor } = getPlugin()

      expect(handlerOptions.clientInterceptors).toHaveLength(2)
      expect(handlerOptions.clientInterceptors![1]).toBe(existingInterceptor)
    })
  })

  describe('polluting inputs', () => {
    it.each([
      ['an own __proto__ key at the top level', () => JSON.parse('{"__proto__": {"isAdmin": true}}')],
      ['an own __proto__ key in a nested object', () => JSON.parse('{"user": {"settings": {"__proto__": {"isAdmin": true}}}}')],
      ['an own __proto__ key inside an array element', () => JSON.parse('[{"__proto__": {"isAdmin": true}}]')],
      ['an own __proto__ key on a null-prototype object', () => {
        const value = Object.create(null)
        Object.defineProperty(value, '__proto__', { value: { isAdmin: true }, enumerable: true, configurable: true, writable: true })
        return { value }
      }],
      ['a constructor key holding a prototype key', () => JSON.parse('{"constructor": {"prototype": {"isAdmin": true}}}')],
      ['a nested constructor.prototype pair', () => JSON.parse('{"user": {"constructor": {"prototype": {"isAdmin": true}}}}')],
      ['a polluting object used as a Map key', () => new Map([[JSON.parse('{"__proto__": {}}'), 'value']])],
      ['a polluting object used as a Map value', () => new Map([['key', JSON.parse('{"__proto__": {}}')]])],
      ['a polluting object inside a Set', () => new Set([JSON.parse('{"constructor": {"prototype": {}}}')])],
      ['a polluting object behind a benign constructor key', () => JSON.parse('{"constructor": {"nested": {"__proto__": {}}}}')],
    ])('blocks %s', async (_, createInput) => {
      await expectBlocked(createInput())
    })
  })

  describe('benign inputs', () => {
    it.each([
      ['undefined input', () => undefined],
      ['primitive input', () => 'constructor'],
      ['a plain object without special keys', () => ({ user: { name: '__proto__', tags: ['constructor'] } })],
      ['a constructor key holding a string', () => JSON.parse('{"constructor": "Ford"}')],
      ['a constructor key holding an object without a prototype key', () => JSON.parse('{"constructor": {"year": 1913}}')],
      ['a prototype key alone', () => JSON.parse('{"prototype": {"isAdmin": true}}')],
      ['non-plain objects such as dates and files', () => ({ at: new Date(), file: new File(['hi'], 'hi.txt') })],
      ['a benign Map and Set', () => ({ map: new Map([['a', 1]]), set: new Set(['a']) })],
    ])('allows %s', async (_, createInput) => {
      await expectAllowed(createInput())
    })

    it('tolerates cyclic input without hanging', async () => {
      const input: Record<string, unknown> = { name: 'cycle' }
      input.self = input

      await expectAllowed(input)
    })
  })

  describe('deeply nested inputs, beyond call stack limits', () => {
    function nest(leaf: unknown, depth: number) {
      let value = leaf
      for (let i = 0; i < depth; i++) {
        value = { nested: value, list: [value] }
      }
      return value
    }

    it('allows a benign one instead of overflowing the stack', async () => {
      await expectAllowed(nest({ name: 'Earth' }, 100_000))
    })

    it('blocks one polluted at the bottom', async () => {
      await expectBlocked(nest(JSON.parse('{"__proto__": {"isAdmin": true}}'), 100_000))
    })
  })

  describe('asyncIteratorObject inputs', () => {
    function invokeWithIterator(input: AsyncIterator<unknown>) {
      const next = vi.fn(async (options: any) => options.input)
      const { interceptor } = getPlugin()

      return (async () => interceptor({ context: {}, input, next } as any))() as Promise<AsyncIteratorClass<unknown, unknown>>
    }

    it('forwards a guarded iterator and passes benign values through', async () => {
      async function* input() {
        yield { name: 'Earth' }
        yield { name: 'Mars' }
      }

      const original = input()
      const guarded = await invokeWithIterator(original)

      expect(guarded).not.toBe(original)

      const values = []
      for await (const value of guarded) {
        values.push(value)
      }

      expect(values).toEqual([{ name: 'Earth' }, { name: 'Mars' }])
    })

    it('fails the iteration when a yielded value pollutes', async () => {
      async function* input() {
        yield { name: 'Earth' }
        yield JSON.parse('{"__proto__": {"isAdmin": true}}')
      }

      const guarded = await invokeWithIterator(input())

      await expect(guarded.next()).resolves.toEqual({ done: false, value: { name: 'Earth' } })
      await expect(guarded.next()).rejects.toSatisfy(error =>
        error instanceof ORPCError
        && error.code === 'BAD_REQUEST'
        && error.message === 'Request blocked by prototype pollution protection.')
    })

    it('checks the return value too', async () => {
      async function* input() {
        return JSON.parse('{"constructor": {"prototype": {}}}')
      }

      const guarded = await invokeWithIterator(input())

      await expect(guarded.next()).rejects.toSatisfy(error =>
        error instanceof ORPCError && error.code === 'BAD_REQUEST')
    })
  })

  describe('with an RPCHandler', () => {
    const createPlanet = vi.fn(() => 'created')

    function createHandler() {
      return new RPCHandler({ createPlanet: os.handler(createPlanet) }, {
        plugins: [new PrototypePollutionProtectionHandlerPlugin()],
      })
    }

    function createRequest(body: string) {
      return new Request('https://api.example.com/createPlanet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    }

    it('blocks a polluting body with a parseable BAD_REQUEST error', async () => {
      const { matched, response } = await createHandler().handle(
        createRequest('{"json": {"name": "Earth", "__proto__": {"isAdmin": true}}}'),
      )

      expect(matched).toBe(true)
      expect(response!.status).toBe(400)
      await expect(response!.json()).resolves.toMatchObject({
        json: expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Request blocked by prototype pollution protection.',
        }),
      })
      expect(createPlanet).not.toHaveBeenCalled()
    })

    it('blocks a constructor.prototype pair nested in the body', async () => {
      const { response } = await createHandler().handle(
        createRequest('{"json": {"settings": {"constructor": {"prototype": {"isAdmin": true}}}}}'),
      )

      expect(response!.status).toBe(400)
      expect(createPlanet).not.toHaveBeenCalled()
    })

    it('allows a benign body', async () => {
      const { response } = await createHandler().handle(
        createRequest('{"json": {"name": "Earth", "constructor": "Ford"}}'),
      )

      expect(response!.status).toBe(200)
      expect(createPlanet).toHaveBeenCalledOnce()
    })
  })
})
