import type { OpenRPCHandlerOptions } from '../adapters/fetch'
import type { JsonRpcParams } from '../json-rpc'
import type { OpenRPCContentDescriptorObject, OpenRPCMethodObject } from '../types'
import { eventIterator } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { parseEmptyableJSON, stringifyJSON } from '@orpc/shared'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { OpenRPCHandler } from '../adapters/fetch'
import { COMMON_JSON_RPC_ERROR_CODE_MAP } from '../constants'
import { openrpc } from '../meta'
import { OpenRPCGenerator } from '../openrpc-generator'

/**
 * Records every call of the procedures that answer JSON-RPC notifications in the specification examples,
 * so tests can tell a notification that ran from one that was dropped.
 */
export const notified = vi.fn<(method: string, input: unknown) => void>()

const Planet = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.date(),
}).meta({ id: 'Planet' })

const EARTH = { id: 1, name: 'Earth', createdAt: new Date('2024-01-01T00:00:00.000Z') }
const MARS = { id: 2, name: 'Mars', description: 'The red planet', createdAt: new Date('2024-02-01T00:00:00.000Z') }
const PLANETS = [EARTH, MARS]

/**
 * `EARTH` and `MARS` as JSON-RPC results, after serialization.
 */
export const EARTH_JSON = { id: 1, name: 'Earth', createdAt: '2024-01-01T00:00:00.000Z' }
export const MARS_JSON = { id: 2, name: 'Mars', description: 'The red planet', createdAt: '2024-02-01T00:00:00.000Z' }

/**
 * A zod router covering every way `OpenRPCGenerator` maps an input to params, every kind of result,
 * and defined errors, including codes that share one JSON-RPC code and a code missing from the default map.
 *
 * The root procedures are the methods of the JSON-RPC 2.0 specification examples (§7).
 */
export const router = {
  /**
   * by-name, both params required
   */
  subtract: os
    .input(z.object({ minuend: z.number(), subtrahend: z.number() }))
    .output(z.number())
    .handler(({ input }) => input.minuend - input.subtrahend),

  /**
   * by-position, a single array param
   */
  sum: os
    .input(z.array(z.number()))
    .output(z.number())
    .handler(({ input }) => input.reduce((total, value) => total + value, 0)),

  /**
   * by-position, no output schema
   */
  update: os
    .input(z.array(z.number()))
    .handler(({ input }) => {
      notified('update', input)
    }),

  /**
   * by-position, a single primitive param
   */
  notify_hello: os
    .input(z.number())
    .handler(({ input }) => {
      notified('notify_hello', input)
    }),

  notify_sum: os
    .input(z.array(z.number()))
    .handler(({ input }) => {
      notified('notify_sum', input)
    }),

  /**
   * no input schema, a tuple result
   */
  get_data: os
    .output(z.tuple([z.string(), z.number()]))
    .handler(() => ['hello', 5] as [string, number]),

  /**
   * no input or output schema
   */
  ping: os.handler(() => 'pong'),

  /**
   * void input: no params
   */
  health: os
    .input(z.void())
    .output(z.object({ status: z.literal('ok') }))
    .handler(() => ({ status: 'ok' as const })),

  /**
   * unconstrained input: a single optional by-position param
   */
  echo: os
    .input(z.any())
    .handler(({ input }) => input),

  planet: {
    /**
     * by-name, required params first, with the description and deprecated flag of params lifted
     */
    create: os
      .errors({ CONFLICT: { message: 'Planet already exists' } })
      .input(z.object({
        description: z.string().describe('What makes the planet special').optional(),
        name: z.string().min(1),
        code: z.string().meta({ deprecated: true }).optional(),
      }))
      .output(Planet)
      .handler(({ input, errors }) => {
        if (PLANETS.some(planet => planet.name === input.name)) {
          throw errors.CONFLICT()
        }

        return { id: 3, name: input.name, description: input.description, createdAt: EARTH.createdAt }
      }),

    /**
     * by-name from a root `$ref` input, a defined error with data, OpenAPI meta fallback, and an example
     */
    find: os
      .meta(openapi({ summary: 'Find a planet', tags: ['planets'] }))
      .meta(openrpc({ examples: [{ name: 'earth', input: { id: 1 }, output: EARTH }] }))
      .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) } })
      .input(z.object({ id: z.number().int() }).meta({ id: 'PlanetQuery' }))
      .output(Planet)
      .handler(({ input, errors }) => {
        const planet = PLANETS.find(planet => planet.id === input.id)

        if (!planet) {
          throw errors.NOT_FOUND({ data: { id: input.id } })
        }

        return planet
      }),

    /**
     * by-name from an optional object whose properties are all optional
     */
    list: os
      .meta(openrpc({
        examples: [
          { name: 'all', output: PLANETS },
          { name: 'first', input: { limit: 1 }, output: [EARTH] },
        ],
      }))
      .input(z.object({ limit: z.number().int().positive().optional(), cursor: z.string().optional() }).optional())
      .output(z.array(Planet))
      .handler(({ input }) => PLANETS.slice(0, input?.limit ?? PLANETS.length)),

    /**
     * by-position from an optional object with a required property
     */
    search: os
      .input(z.object({ query: z.string() }).optional())
      .output(z.array(Planet))
      .handler(({ input }) => PLANETS.filter(planet => planet.name.includes(input?.query ?? ''))),

    /**
     * by-position from a union
     */
    get: os
      .input(z.union([z.number().int(), z.string()]))
      .output(Planet.optional())
      .handler(({ input }) => PLANETS.find(planet => planet.id === input || planet.name === input)),

    /**
     * by-name from a loose object
     */
    tag: os
      .input(z.looseObject({ id: z.number().int(), tag: z.string() }))
      .output(z.object({ id: z.number().int(), tags: z.array(z.string()) }))
      .handler(({ input }) => ({ id: input.id, tags: [input.tag] })),

    /**
     * by-position from a record
     */
    label: os
      .input(z.record(z.string(), z.string()))
      .output(z.array(z.string()))
      .handler(({ input }) => Object.entries(input).map(([locale, label]) => `${locale}:${label}`)),

    /**
     * by-position from a tuple, lowered to a draft-07 tuple
     */
    move: os
      .input(z.tuple([z.number(), z.number()]))
      .output(z.object({ x: z.number(), y: z.number() }))
      .handler(({ input: [x, y] }) => ({ x, y })),

    /**
     * by-position from a nullable object, an optional result
     */
    rename: os
      .input(z.object({ id: z.number().int(), name: z.string() }).nullable())
      .output(z.string().optional())
      .handler(({ input }) => input === null ? undefined : `${input.id}:${input.name}`),

    /**
     * by-position from a primitive, a void result
     */
    remove: os
      .meta(openrpc({ deprecated: true, description: 'Removes a planet' }))
      .errors({ FORBIDDEN: {} })
      .input(z.number().int())
      .output(z.void())
      .handler(({ input, errors }) => {
        if (input === EARTH.id) {
          throw errors.FORBIDDEN()
        }
      }),

    /**
     * two defined errors sharing one JSON-RPC code
     */
    sync: os
      .errors({ BAD_GATEWAY: {}, SERVICE_UNAVAILABLE: { message: 'Try again later' } })
      .output(z.void())
      .handler(({ errors }) => {
        throw errors.SERVICE_UNAVAILABLE()
      }),

    /**
     * a defined error missing from the default error code map
     */
    reserve: os
      .errors({ OUT_OF_STOCK: { message: 'No planets left', data: z.object({ available: z.number().int() }) } })
      .input(z.object({ id: z.number().int() }))
      .output(z.void())
      .handler(({ errors }) => {
        throw errors.OUT_OF_STOCK({ data: { available: 0 } })
      }),

    /**
     * always excluded: an event iterator output
     */
    watch: os
      .output(eventIterator(Planet))
      .handler(async function* () {
        yield EARTH
      }),
  },

  internal: {
    /**
     * excluded by {@link filter}
     */
    purge: os.handler(() => 'purged'),
  },
}

/**
 * The filter both the generator and the handler use.
 */
export function filter(_procedure: unknown, path: readonly string[]): boolean {
  return path[0] !== 'internal'
}

/**
 * Methods of {@link router} that are never served nor documented.
 */
export const EXCLUDED_METHODS = ['planet.watch', 'internal.purge']

/**
 * The error code map with a code for the error the default map misses.
 */
export const CUSTOM_ERROR_CODE_MAP = { ...COMMON_JSON_RPC_ERROR_CODE_MAP, OUT_OF_STOCK: 1001 }

export interface FixtureCall {
  method: string
  /**
   * The (serialized) procedure input; `undefined` sends no input.
   */
  input?: unknown
}

export interface FixtureSuccessCall extends FixtureCall {
  result: unknown
}

export interface FixtureErrorCall extends FixtureCall {
  error: { code: string, message: string, data?: unknown }
}

/**
 * Calls that succeed, at least one per documented method.
 */
export const SUCCESS_CALLS: FixtureSuccessCall[] = [
  { method: 'subtract', input: { minuend: 42, subtrahend: 23 }, result: 19 },
  { method: 'sum', input: [1, 2, 4], result: 7 },
  { method: 'sum', input: [], result: 0 },
  { method: 'update', input: [1, 2, 3, 4, 5], result: null },
  { method: 'notify_hello', input: 7, result: null },
  { method: 'notify_sum', input: [1, 2, 4], result: null },
  { method: 'get_data', result: ['hello', 5] },
  { method: 'ping', result: 'pong' },
  { method: 'health', result: { status: 'ok' } },
  { method: 'echo', result: null },
  { method: 'echo', input: { nested: [1, 'two', null] }, result: { nested: [1, 'two', null] } },
  { method: 'echo', input: 'text', result: 'text' },
  { method: 'planet.create', input: { name: 'Venus' }, result: { id: 3, name: 'Venus', createdAt: '2024-01-01T00:00:00.000Z' } },
  { method: 'planet.create', input: { name: 'Venus', description: 'Hot', code: 'V' }, result: { id: 3, name: 'Venus', description: 'Hot', createdAt: '2024-01-01T00:00:00.000Z' } },
  { method: 'planet.find', input: { id: 2 }, result: MARS_JSON },
  { method: 'planet.list', result: [EARTH_JSON, MARS_JSON] },
  { method: 'planet.list', input: {}, result: [EARTH_JSON, MARS_JSON] },
  { method: 'planet.list', input: { limit: 1 }, result: [EARTH_JSON] },
  { method: 'planet.search', result: [EARTH_JSON, MARS_JSON] },
  { method: 'planet.search', input: { query: 'Mar' }, result: [MARS_JSON] },
  { method: 'planet.get', input: 1, result: EARTH_JSON },
  { method: 'planet.get', input: 'Mars', result: MARS_JSON },
  { method: 'planet.get', input: 'Pluto', result: null },
  { method: 'planet.tag', input: { id: 1, tag: 'home' }, result: { id: 1, tags: ['home'] } },
  { method: 'planet.label', input: { en: 'Earth', fr: 'Terre' }, result: ['en:Earth', 'fr:Terre'] },
  { method: 'planet.move', input: [3, 4], result: { x: 3, y: 4 } },
  { method: 'planet.rename', input: { id: 1, name: 'Terra' }, result: '1:Terra' },
  { method: 'planet.rename', input: null, result: null },
  { method: 'planet.remove', input: 2, result: null },
]

/**
 * Calls that fail with a defined error.
 */
export const ERROR_CALLS: FixtureErrorCall[] = [
  { method: 'planet.create', input: { name: 'Earth' }, error: { code: 'CONFLICT', message: 'Planet already exists' } },
  { method: 'planet.find', input: { id: 3 }, error: { code: 'NOT_FOUND', message: 'Planet not found', data: { id: 3 } } },
  { method: 'planet.remove', input: 1, error: { code: 'FORBIDDEN', message: 'Forbidden' } },
  { method: 'planet.sync', error: { code: 'SERVICE_UNAVAILABLE', message: 'Try again later' } },
  { method: 'planet.reserve', input: { id: 1 }, error: { code: 'OUT_OF_STOCK', message: 'No planets left', data: { available: 0 } } },
]

/**
 * Calls whose input the document and the handler both reject.
 */
export const INVALID_CALLS: FixtureCall[] = [
  { method: 'subtract', input: { minuend: 42 } },
  { method: 'subtract', input: { minuend: 42, subtrahend: '23' } },
  { method: 'sum', input: [1, '2'] },
  { method: 'notify_hello', input: 'seven' },
  { method: 'planet.create', input: { description: 'Nameless' } },
  { method: 'planet.find', input: { id: 1.5 } },
  { method: 'planet.list', input: { limit: 0 } },
  { method: 'planet.search', input: { query: 1 } },
  { method: 'planet.get', input: true },
  { method: 'planet.label', input: { en: 1 } },
  { method: 'planet.move', input: [3] },
  { method: 'planet.rename', input: { id: 1 } },
  { method: 'planet.remove', input: 'Earth' },
]

export function createGenerator(): OpenRPCGenerator {
  return new OpenRPCGenerator({ converters: [new ZodToJsonSchemaConverter()] })
}

export function createHandler(options: OpenRPCHandlerOptions<Record<never, never>> = {}): OpenRPCHandler<Record<never, never>> {
  return new OpenRPCHandler(router, { filter, ...options })
}

/**
 * Builds the `params` of a call the way a generic client reads them from the method's description:
 * nothing for a method without params, one member per documented param for by-name methods
 * (nothing without input), and the input as the single param for by-position methods.
 */
export function toDocumentedParams(method: OpenRPCMethodObject, input: unknown): JsonRpcParams | undefined {
  const descriptors = method.params as OpenRPCContentDescriptorObject[]

  if (descriptors.length === 0) {
    return undefined
  }

  if (method.paramStructure === 'by-name') {
    // all params are optional, as the generator only splits an optional input when they are
    if (input === undefined) {
      return undefined
    }

    const members = input as Record<string, unknown>
    const undocumented = Object.keys(members).filter(name => !descriptors.some(descriptor => descriptor.name === name))

    if (undocumented.length) {
      throw new TypeError(`"${method.name}" documents no params named ${undocumented.join(', ')}`)
    }

    return Object.fromEntries(descriptors.flatMap(({ name }) => Object.hasOwn(members, name) ? [[name, members[name]]] : []))
  }

  if (descriptors.length !== 1) {
    throw new TypeError(`"${method.name}" documents ${descriptors.length} by-position params, a single one is expected`)
  }

  return input === undefined ? [] : [input]
}

export interface JsonRpcHttpResponse {
  status: number
  contentType: string | null
  /**
   * The parsed body, or `undefined` for an empty one.
   */
  body: unknown
}

/**
 * POSTs a body (serialized unless already a string) to the handler at `/rpc`.
 */
export async function post(
  handler: OpenRPCHandler<Record<never, never>>,
  body: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Promise<JsonRpcHttpResponse> {
  const { matched, response } = await handler.handle(
    new Request('https://example.com/rpc', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : stringifyJSON(body),
    }),
    { prefix: '/rpc', context: {} },
  )

  if (!matched) {
    throw new Error('The handler did not match the request')
  }

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: parseEmptyableJSON(await response.text()),
  }
}
