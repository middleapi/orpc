import type { ServerContext } from '@modelcontextprotocol/server'
import type { JsonSchemaConverter } from '@orpc/json-schema'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { getResponseHeaders, ORPCError } from '@orpc/client'
import { asyncIteratorObject, oc, type } from '@orpc/contract'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { openapi, OpenAPISerializer } from '@orpc/openapi'
import { implement, os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { z } from 'zod'
import { createTestClient, createTestServer, PROTOCOL_ERAS } from './__tests__/utils'
import { mcp } from './meta'
import { McpRegistrar } from './registrar'

const planetSchema = z.object({ id: z.number(), name: z.string() })

/**
 * Asserts a tool call failed with a tool execution error, and returns the error JSON the model reads.
 */
function parseToolError(result: { isError?: unknown, content?: unknown }): any {
  expect(result.isError).toBe(true)
  return JSON.parse((result.content as any)[0].text)
}

const router = {
  planet: {
    list: os
      .meta(openapi({ method: 'GET', summary: 'List planets', description: 'List planets, newest first' }))
      .input(z.object({ limit: z.number().optional() }))
      .output(z.array(planetSchema))
      .handler(({ input }) => [{ id: 1, name: 'Earth' }, { id: 2, name: 'Mars' }].slice(0, input.limit)),
    find: os
      .errors({ NOT_FOUND: { message: 'Planet not found', data: z.object({ id: z.number() }) } })
      .input(z.object({ id: z.number() }))
      .output(planetSchema.extend({ discoveredAt: z.date() }))
      .handler(({ input, errors }) => {
        if (input.id !== 1) {
          throw errors.NOT_FOUND({ data: { id: input.id } })
        }

        return { id: 1, name: 'Earth', discoveredAt: new Date('2020-01-01T00:00:00.000Z') }
      }),
    describe: os
      .input(z.object({ id: z.number() }))
      .handler(() => 'A blue planet'),
  },
}

describe.each(PROTOCOL_ERAS)('mcpRegistrar - %s protocol', (era) => {
  it('lists procedures as tools', async () => {
    const client = await createTestClient(era, new McpRegistrar(router))

    const { tools } = await client.listTools()

    expect(tools.map(tool => tool.name)).toEqual(['planet_list', 'planet_find', 'planet_describe'])

    expect(tools[0]).toEqual(expect.objectContaining({
      name: 'planet_list',
      title: 'List planets',
      description: 'List planets, newest first',
      annotations: { readOnlyHint: true },
      inputSchema: expect.objectContaining({
        type: 'object',
        properties: { limit: { type: 'number' } },
      }),
    }))

    const planetsJsonSchema = expect.objectContaining({
      type: 'array',
      items: expect.objectContaining({ properties: { id: { type: 'number' }, name: { type: 'string' } } }),
    })

    // the 2025 protocol requires object output schemas, so the MCP SDK nests other schemas under `result`
    expect(tools[0]!.outputSchema).toEqual(era === 'legacy'
      ? { type: 'object', properties: { result: planetsJsonSchema }, required: ['result'] }
      : planetsJsonSchema)

    expect(tools[2]!.outputSchema).toBeUndefined()
  })

  it('calls procedures and returns their output as structured content', async () => {
    const client = await createTestClient(era, new McpRegistrar(router))

    const result = await client.callTool({ name: 'planet_find', arguments: { id: 1 } })

    const expected = { id: 1, name: 'Earth', discoveredAt: '2020-01-01T00:00:00.000Z' }

    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toEqual(expected)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(expected) }])
  })

  it('returns non-object outputs as structured content', async () => {
    const client = await createTestClient(era, new McpRegistrar(router))

    const result = await client.callTool({ name: 'planet_list', arguments: { limit: 1 } })

    expect(result.content).toEqual([{ type: 'text', text: '[{"id":1,"name":"Earth"}]' }])
    // the 2025 protocol requires object structured content, so the MCP SDK nests other values under `result`
    expect(result.structuredContent).toEqual(
      era === 'legacy' ? { result: [{ id: 1, name: 'Earth' }] } : [{ id: 1, name: 'Earth' }],
    )
  })

  it('returns string outputs as plain text', async () => {
    const client = await createTestClient(era, new McpRegistrar(router))

    const result = await client.callTool({ name: 'planet_describe', arguments: { id: 1 } })

    expect(result.content).toEqual([{ type: 'text', text: 'A blue planet' }])
  })

  it('reports errors as tool execution errors', async () => {
    const client = await createTestClient(era, new McpRegistrar(router))

    const result = await client.callTool({ name: 'planet_find', arguments: { id: 2 } })

    expect(result.structuredContent).toBeUndefined()
    expect(parseToolError(result)).toEqual({
      defined: true,
      code: 'NOT_FOUND',
      message: 'Planet not found',
      data: { id: 2 },
    })
  })

  it('reports input validation errors so the model can correct the arguments', async () => {
    const client = await createTestClient(era, new McpRegistrar(router))

    const result = await client.callTool({ name: 'planet_find', arguments: { id: 'not-a-number' } })

    expect(parseToolError(result)).toEqual({
      defined: false,
      code: 'BAD_REQUEST',
      message: 'Input validation failed',
      data: {
        issues: [expect.objectContaining({ path: ['id'], message: expect.any(String) })],
      },
    })
  })

  it('reports async iterator events as progress and returns the last event', async () => {
    const deploy = os
      .input(z.object({ app: z.string() }))
      .output(asyncIteratorObject(z.object({ status: z.string() })))
      .handler(async function* ({ input }) {
        yield { status: 'building' }
        yield { status: `deployed ${input.app}` }
      })

    const client = await createTestClient(era, new McpRegistrar({ deploy }))

    const { tools } = await client.listTools()
    expect(tools[0]!.outputSchema).toEqual(expect.objectContaining({
      type: 'object',
      properties: { status: { type: 'string' } },
    }))

    const onprogress = vi.fn()
    const result = await client.callTool({ name: 'deploy', arguments: { app: 'web' } }, { onprogress })

    expect(result.structuredContent).toEqual({ status: 'deployed web' })
    expect(onprogress).toHaveBeenCalledTimes(2)
    expect(onprogress).toHaveBeenNthCalledWith(1, expect.objectContaining({ progress: 1, message: '{"status":"building"}' }))
    expect(onprogress).toHaveBeenNthCalledWith(2, expect.objectContaining({ progress: 2, message: '{"status":"deployed web"}' }))
  })
})

describe('mcpRegistrar', () => {
  it('returns the registered tools by name', async () => {
    const server = createTestServer()
    const { tools } = await new McpRegistrar(router).register(server)

    expect(Object.keys(tools)).toEqual(['planet_list', 'planet_find', 'planet_describe'])
    expect(tools.planet_list!.title).toBe('List planets')
  })

  describe('tool definition', () => {
    it('inherits name, title, description, and annotations from OpenAPI meta', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        get: os.meta(openapi({ method: 'GET', operationId: 'getPlanet', summary: 'Get a planet' })).handler(() => {}),
        head: os.meta(openapi({ method: 'HEAD', description: 'Check a planet' })).handler(() => {}),
        query: os.meta(openapi({ method: 'QUERY' })).handler(() => {}),
        put: os.meta(openapi({ method: 'PUT' })).handler(() => {}),
        delete: os.meta(openapi({ method: 'DELETE' })).handler(() => {}),
        post: os.meta(openapi({ method: 'POST' })).handler(() => {}),
        patch: os.meta(openapi({ method: 'PATCH' })).handler(() => {}),
        none: os.handler(() => {}),
      }))

      const { tools } = await client.listTools()

      expect(tools.map(({ name, title, description, annotations }) => ({ name, title, description, annotations }))).toEqual([
        { name: 'getPlanet', title: 'Get a planet', description: 'Get a planet', annotations: { readOnlyHint: true } },
        { name: 'head', description: 'Check a planet', annotations: { readOnlyHint: true } },
        { name: 'query', annotations: { readOnlyHint: true } },
        { name: 'put', annotations: { idempotentHint: true } },
        { name: 'delete', annotations: { idempotentHint: true } },
        { name: 'post' },
        { name: 'patch' },
        { name: 'none' },
      ])
    })

    it('prefers mcp.tool meta over OpenAPI meta', async () => {
      const procedure = os
        .meta(openapi({ method: 'GET', operationId: 'getPlanet', summary: 'Get a planet', description: 'OpenAPI description' }))
        .meta(mcp.tool({
          name: 'get_planet',
          title: 'Planet',
          description: 'MCP description',
          annotations: { openWorldHint: false },
          icons: [{ src: 'https://example.com/planet.png', mimeType: 'image/png' }],
          _meta: { source: 'planets' },
        }))
        .handler(() => {})

      const client = await createTestClient('legacy', new McpRegistrar({ procedure }))

      const { tools } = await client.listTools()

      expect(tools).toEqual([expect.objectContaining({
        name: 'get_planet',
        title: 'Planet',
        description: 'MCP description',
        annotations: { readOnlyHint: true, openWorldHint: false },
        icons: [{ src: 'https://example.com/planet.png', mimeType: 'image/png' }],
        _meta: { source: 'planets' },
      })])
    })

    it('lets mcp.tool annotations override inferred hints', async () => {
      const procedure = os
        .meta(openapi({ method: 'GET' }))
        .meta(mcp.tool({ annotations: { readOnlyHint: false, destructiveHint: false } }))
        .handler(() => {})

      const client = await createTestClient('legacy', new McpRegistrar({ procedure }))

      const { tools } = await client.listTools()

      expect(tools[0]!.annotations).toEqual({ readOnlyHint: false, destructiveHint: false })
    })

    it('names nested and lazy procedures by their path', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        planet: {
          moon: { list: os.handler(() => []) },
          lazy: os.lazy(() => Promise.resolve({ default: { find: os.handler(() => ({})) } })),
        },
      }))

      const { tools } = await client.listTools()

      expect(tools.map(tool => tool.name)).toEqual(['planet_moon_list', 'planet_lazy_find'])
    })

    it('throws when two procedures share a tool name', async () => {
      const server = createTestServer()

      await expect(new McpRegistrar({
        a: { b: os.handler(() => {}) },
        a_b: os.handler(() => {}),
      }).register(server)).rejects.toThrow('[MCP] Procedures at "a.b" and "a_b" share the tool name "a_b".')

      await expect(new McpRegistrar({
        a: os.meta(openapi({ operationId: 'same' })).handler(() => {}),
        b: os.meta(mcp.tool({ name: 'same' })).handler(() => {}),
      }).register(server)).rejects.toThrow('[MCP] Procedures at "a" and "b" share the tool name "same".')
    })

    it('throws when a tool name cannot be derived', async () => {
      const server = createTestServer()

      await expect(new McpRegistrar(os.handler(() => {})).register(server)).rejects.toThrow(
        '[MCP] Procedure at "(root)" has no name. Set one with mcp.tool({ name }).',
      )

      const { tools } = await new McpRegistrar(os.meta(mcp.tool({ name: 'root' })).handler(() => {})).register(server)
      expect(Object.keys(tools)).toEqual(['root'])
    })

    it('registers nothing when any procedure is invalid', async () => {
      const server = createTestServer()
      const registerTool = vi.spyOn(server, 'registerTool')

      await expect(new McpRegistrar({
        a: os.handler(() => {}),
        b: os.meta(mcp.tool({ name: 'a' })).handler(() => {}),
      }).register(server)).rejects.toThrow()

      expect(registerTool).not.toHaveBeenCalled()
    })

    it('skips procedures rejected by the filter', async () => {
      const filter = vi.fn((_contract, path: string[]) => path.at(-1) !== 'find')

      const client = await createTestClient('legacy', new McpRegistrar(router, { filter }))

      const { tools } = await client.listTools()

      expect(tools.map(tool => tool.name)).toEqual(['planet_list', 'planet_describe'])
      expect(filter).toHaveBeenCalledWith(router.planet.find, ['planet', 'find'])
    })
  })

  describe('input', () => {
    it('advertises an empty object schema when the procedure has no input schema', async () => {
      const handler = vi.fn(() => 'ok')
      const client = await createTestClient('legacy', new McpRegistrar({ ping: os.handler(handler) }))

      const { tools } = await client.listTools()
      expect(tools[0]!.inputSchema).toEqual({ type: 'object', properties: {} })

      await client.callTool({ name: 'ping' })
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ input: {} }), {})
    })

    it('passes no input for empty arguments when the input accepts no object', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        void: os.input(z.void()).handler(({ input }) => input === undefined),
        undefined: os.input(z.undefined()).handler(({ input }) => input === undefined),
        defaults: os.input(z.object({ limit: z.number().default(10) })).handler(({ input }) => input.limit),
      }))

      expect((await client.callTool({ name: 'void' })).content).toEqual([{ type: 'text', text: 'true' }])
      expect((await client.callTool({ name: 'undefined', arguments: {} })).content).toEqual([{ type: 'text', text: 'true' }])
      // an object input still receives the empty arguments, so its defaults apply
      expect((await client.callTool({ name: 'defaults' })).content).toEqual([{ type: 'text', text: '10' }])
    })

    it('advertises an object schema when the input has no JSON Schema', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        ping: os.input(type<{ name: string }>()).handler(({ input }) => input.name),
      }))

      const { tools } = await client.listTools()
      expect(tools[0]!.inputSchema).toEqual({ type: 'object' })

      const result = await client.callTool({ name: 'ping', arguments: { name: 'Earth' } })
      expect(result.content).toEqual([{ type: 'text', text: 'Earth' }])
    })

    it('combines multiple input schemas', async () => {
      const procedure = os
        .input(z.object({ id: z.number() }))
        .input(z.object({ name: z.string() }))
        .handler(({ input }) => input)

      const client = await createTestClient('legacy', new McpRegistrar({ procedure }))

      const { tools } = await client.listTools()
      expect(tools[0]!.inputSchema).toEqual({
        type: 'object',
        allOf: [
          expect.objectContaining({ properties: { id: { type: 'number' } } }),
          expect.objectContaining({ properties: { name: { type: 'string' } } }),
        ],
      })

      const result = await client.callTool({ name: 'procedure', arguments: { id: 1, name: 'Earth' } })
      expect(result.structuredContent).toEqual({ id: 1, name: 'Earth' })
    })

    it('nests a non-object input under `input`, since tool arguments must be an object', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        required: os.input(z.string()).handler(({ input }) => `required ${input}`),
        optional: os.input(z.string().optional()).handler(({ input }) => `optional ${input}`),
        union: os.input(z.union([z.object({ id: z.number() }), z.number()])).handler(({ input }) => input),
        intersection: os.input(z.intersection(z.object({ id: z.number() }), z.any())).handler(({ input }) => input),
      }))

      const { tools } = await client.listTools()

      expect(tools[0]!.inputSchema).toEqual({
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
      })

      expect(tools[1]!.inputSchema).toEqual({
        type: 'object',
        properties: { input: { type: 'string' } },
      })

      expect(tools[2]!.inputSchema).toEqual({
        type: 'object',
        properties: { input: { anyOf: [expect.objectContaining({ type: 'object' }), { type: 'number' }] } },
        required: ['input'],
      })

      expect((await client.callTool({ name: 'required', arguments: { input: 'Earth' } })).content)
        .toEqual([{ type: 'text', text: 'required Earth' }])

      expect((await client.callTool({ name: 'optional', arguments: {} })).content)
        .toEqual([{ type: 'text', text: 'optional undefined' }])

      expect((await client.callTool({ name: 'union', arguments: { input: 1 } })).content)
        .toEqual([{ type: 'text', text: '1' }])

      // an object-only input stays unwrapped, even when composed with an unconstrained schema
      expect(tools[3]!.inputSchema).toEqual({
        type: 'object',
        allOf: [expect.objectContaining({ type: 'object' }), {}],
      })

      expect((await client.callTool({ name: 'intersection', arguments: { id: 1 } })).structuredContent)
        .toEqual({ id: 1 })
    })

    it('keeps defs reachable when nesting a recursive input', async () => {
      interface Category { name: string, children: Category[] }
      const category: z.ZodType<Category> = z.lazy(() => z.object({ name: z.string(), children: z.array(category) }))

      const client = await createTestClient('legacy', new McpRegistrar({
        list: os.input(z.array(category)).handler(({ input }) => input.length),
      }))

      const { tools } = await client.listTools()
      const inputSchema = tools[0]!.inputSchema as any

      expect(inputSchema.type).toBe('object')
      expect(inputSchema.required).toEqual(['input'])
      expect(inputSchema.properties.input.type).toBe('array')
      expect(JSON.stringify(inputSchema.properties.input)).toContain('#/$defs/')
      expect(Object.keys(inputSchema.$defs)).not.toHaveLength(0)

      const result = await client.callTool({ name: 'list', arguments: { input: [{ name: 'Rocky', children: [] }] } })
      expect(result.content).toEqual([{ type: 'text', text: '1' }])
    })

    it('uses JSON Schema converters', async () => {
      const converter: JsonSchemaConverter = {
        condition: schema => schema !== undefined && schema['~standard'].vendor === 'custom',
        convert: () => [{ type: 'object', properties: { custom: { type: 'boolean' } } }, false],
      }

      const custom = type<{ custom: boolean }>()
      ;(custom['~standard'] as any).vendor = 'custom'

      const client = await createTestClient('legacy', new McpRegistrar({
        procedure: os.input(custom).handler(() => {}),
      }, { converters: [converter] }))

      const { tools } = await client.listTools()
      expect(tools[0]!.inputSchema).toEqual({ type: 'object', properties: { custom: { type: 'boolean' } } })
    })

    it('coerces arguments with the Smart Coercion Plugin', async () => {
      const procedure = os
        .input(z.object({ at: z.date(), count: z.number() }))
        .handler(({ input }) => ({ year: input.at.getUTCFullYear(), count: input.count }))

      const converters = [new ZodToJsonSchemaConverter()]
      const client = await createTestClient('legacy', new McpRegistrar({ procedure }, {
        converters,
        plugins: [new SmartCoercionHandlerPlugin({ converters })],
      }))

      const { tools } = await client.listTools()
      expect(tools[0]!.inputSchema).toEqual(expect.objectContaining({
        properties: {
          at: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
          count: { type: 'number' },
        },
      }))

      const args = { at: '2020-01-01T00:00:00.000Z', count: '2' }

      const result = await client.callTool({ name: 'procedure', arguments: args })
      expect(result.structuredContent).toEqual({ year: 2020, count: 2 })

      // arguments are not coerced without the plugin
      const uncoerced = await createTestClient('legacy', new McpRegistrar({ procedure }, { converters }))

      const failed = await uncoerced.callTool({ name: 'procedure', arguments: args })
      expect(failed.isError).toBe(true)
    })

    it('configures the Smart Coercion Plugin, which also coerces inputs nested under `input`', async () => {
      const procedure = os
        .input(z.object({ big: z.bigint() }))
        .handler(({ input }) => input.big + 1n)

      const converters = [new ZodToJsonSchemaConverter()]
      const client = await createTestClient('legacy', new McpRegistrar({ procedure, date: os.input(z.date()).handler(({ input }) => input.getUTCFullYear()) }, {
        converters,
        plugins: [new SmartCoercionHandlerPlugin({ converters, maxBigIntDigits: 2 })],
      }))

      expect((await client.callTool({ name: 'procedure', arguments: { big: '12' } })).content)
        .toEqual([{ type: 'text', text: '13' }])

      expect((await client.callTool({ name: 'procedure', arguments: { big: '123' } })).isError).toBe(true)

      // coerced after unwrapping from `input`
      expect((await client.callTool({ name: 'date', arguments: { input: '2020-01-01T00:00:00.000Z' } })).content)
        .toEqual([{ type: 'text', text: '2020' }])
    })
  })

  describe('output', () => {
    it('serializes outputs like OpenAPI responses', async () => {
      const procedure = os.handler(() => ({
        date: new Date('2020-01-01T00:00:00.000Z'),
        bigint: 1n,
        set: new Set([1, 2]),
        map: new Map([['a', 1]]),
        url: new URL('https://example.com'),
        undefined,
      }))

      const client = await createTestClient('legacy', new McpRegistrar({ procedure }))

      const result = await client.callTool({ name: 'procedure' })

      const expected = {
        date: '2020-01-01T00:00:00.000Z',
        bigint: '1',
        set: [1, 2],
        map: [['a', 1]],
        url: 'https://example.com/',
      }

      expect(result.structuredContent).toEqual(expected)
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(expected) }])
    })

    it('serializes outputs and error data with a custom serializer, such as the one of an OpenAPI handler', async () => {
      class Planet {
        constructor(public name: string) {}
      }

      const serializer = new OpenAPISerializer({
        handlers: { planet: { condition: data => data instanceof Planet, serialize: (planet: Planet) => `planet:${planet.name}` } },
      })

      const client = await createTestClient('legacy', new McpRegistrar({
        find: os.handler(() => ({ planet: new Planet('Earth') })),
        fail: os.handler(() => {
          throw new ORPCError('CONFLICT', { data: { planet: new Planet('Mars') } })
        }),
      }, { serializer }))

      expect((await client.callTool({ name: 'find' })).structuredContent).toEqual({ planet: 'planet:Earth' })
      expect(parseToolError(await client.callTool({ name: 'fail' })).data).toEqual({ planet: 'planet:Mars' })
    })

    it('returns no content for undefined outputs', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        withoutSchema: os.handler(() => {}),
        withSchema: os.output(z.object({ id: z.number() }).optional()).handler(() => undefined),
      }))

      const { tools } = await client.listTools()
      // an output schema requires structured content in every result
      expect(tools[1]!.outputSchema).toBeUndefined()

      expect(await client.callTool({ name: 'withoutSchema' })).toEqual({ content: [] })
      expect(await client.callTool({ name: 'withSchema' })).toEqual({ content: [] })
    })

    it('returns blob outputs as image, audio, or embedded resource content', async () => {
      const bytes = new Uint8Array([1, 2, 3])

      const client = await createTestClient('legacy', new McpRegistrar({
        image: os.output(z.file()).handler(() => new File([bytes], 'planet.png', { type: 'image/png' })),
        audio: os.handler(() => new Blob([bytes], { type: 'audio/wav' })),
        file: os.handler(() => new File([bytes], 'planet report.pdf', { type: 'application/pdf' })),
        blob: os.handler(() => new Blob([bytes])),
        stream: os.handler(() => new Blob([bytes], { type: 'text/plain' }).stream()),
      }))

      const { tools } = await client.listTools()
      expect(tools[0]!.outputSchema).toBeUndefined()

      expect((await client.callTool({ name: 'image' })).content)
        .toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }])

      expect((await client.callTool({ name: 'audio' })).content)
        .toEqual([{ type: 'audio', data: 'AQID', mimeType: 'audio/wav' }])

      expect((await client.callTool({ name: 'file' })).content)
        .toEqual([{ type: 'resource', resource: { uri: 'file:///planet%20report.pdf', mimeType: 'application/pdf', blob: 'AQID' } }])

      expect((await client.callTool({ name: 'blob' })).content)
        .toEqual([{ type: 'resource', resource: { uri: 'file:///blob', mimeType: 'application/octet-stream', blob: 'AQID' } }])

      expect((await client.callTool({ name: 'stream' })).content)
        .toEqual([{ type: 'resource', resource: { uri: 'file:///blob', mimeType: 'application/octet-stream', blob: 'AQID' } }])
    })

    it('also returns nested blob outputs as embedded resources named by their paths', async () => {
      const bytes = new Uint8Array([1, 2, 3])

      const client = await createTestClient('legacy', new McpRegistrar({
        report: os
          .output(z.object({ title: z.string(), file: z.file(), covers: z.array(z.file()) }))
          .handler(() => ({
            title: 'Q3',
            file: new File([bytes], 'q3 report.pdf', { type: 'application/pdf' }),
            covers: [new File([bytes], '', { type: 'image/png' })],
          })),
      }))

      const { tools } = await client.listTools()
      expect(tools[0]!.outputSchema).toBeUndefined()

      expect(await client.callTool({ name: 'report' })).toEqual({
        content: [
          { type: 'text', text: '{"title":"Q3","file":{},"covers":[{}]}' },
          { type: 'resource', resource: { uri: 'file:///file/q3%20report.pdf', mimeType: 'application/pdf', blob: 'AQID' } },
          { type: 'resource', resource: { uri: 'file:///covers/0', mimeType: 'image/png', blob: 'AQID' } },
        ],
        // the in-memory transport keeps the files, which other transports serialize as empty objects
        structuredContent: { title: 'Q3', file: expect.any(File), covers: [expect.any(File)] },
      })
    })

    it('types stream outputs with the content-type response header', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        image: os.handler(({ context }) => {
          getResponseHeaders(context)?.set('content-type', 'image/png')
          return new Blob([new Uint8Array([1, 2, 3])]).stream()
        }),
      }))

      expect((await client.callTool({ name: 'image' })).content)
        .toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }])
    })

    it('returns the last event of async generator handlers', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        stream: os.handler(async function* () {
          yield 'first'
          yield 'last'
        }),
        empty: os.handler(async function* () {}),
      }))

      const { tools } = await client.listTools()
      expect(tools[0]!.outputSchema).toBeUndefined()

      expect((await client.callTool({ name: 'stream' })).content).toEqual([{ type: 'text', text: 'last' }])
      expect((await client.callTool({ name: 'empty' })).content).toEqual([])
    })

    it('reports blob events as progress without a message', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        render: os.handler(async function* () {
          yield new Blob([new Uint8Array([1])], { type: 'image/png' })
          yield new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        }),
      }))

      const onprogress = vi.fn()
      const result = await client.callTool({ name: 'render' }, { onprogress })

      expect(result.content).toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }])
      expect(onprogress).toHaveBeenCalledTimes(2)
      expect(onprogress).toHaveBeenLastCalledWith({ progress: 2 })
    })

    it('reports errors thrown while streaming', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        stream: os.handler(async function* () {
          yield 'first'
          throw new ORPCError('CONFLICT', { message: 'Deploy in progress' })
        }),
      }))

      const result = await client.callTool({ name: 'stream' })

      expect(parseToolError(result)).toEqual(expect.objectContaining({ code: 'CONFLICT', message: 'Deploy in progress' }))
    })

    it('stops consuming async iterators once the call is aborted', async () => {
      const abortController = new AbortController()
      const cleanup = vi.fn()

      const procedure = os.handler(async function* () {
        try {
          yield 'first'
          abortController.abort()
          yield 'second'
          yield 'third'
        }
        finally {
          cleanup()
        }
      })

      const server = createTestServer()
      const { tools } = await new McpRegistrar({ procedure }).register(server)

      const result = await tools.procedure!.handler(
        {} as any,
        { mcpReq: { signal: abortController.signal, _meta: {} } } as any,
      )

      expect(result).toEqual(expect.objectContaining({ isError: true }))
      expect(cleanup).toHaveBeenCalledTimes(1)
    })
  })

  describe('errors', () => {
    it('hides details of errors that are not ORPCErrors', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        procedure: os.handler(() => {
          throw new Error('database password is hunter2')
        }),
      }))

      const result = await client.callTool({ name: 'procedure' })

      expect(parseToolError(result)).toEqual({
        defined: false,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal Server Error',
      })
    })

    it('reports errors with custom codes as tool execution errors', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        procedure: os.handler(() => {
          throw new ORPCError('PLANET_GONE', { message: 'The planet is gone' })
        }),
      }))

      const result = await client.callTool({ name: 'procedure' })

      expect(parseToolError(result)).toEqual(expect.objectContaining({ code: 'PLANET_GONE', message: 'The planet is gone' }))
    })

    it('also returns blobs nested in error data as embedded resources named by their paths', async () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'log.txt', { type: 'text/plain' })

      const client = await createTestClient('legacy', new McpRegistrar({
        procedure: os.handler(() => {
          throw new ORPCError('CONFLICT', { data: { log: file } })
        }),
        stream: os.handler(async function* () {
          yield 'first'
          throw new ORPCError('CONFLICT', { data: { log: file } })
        }),
      }))

      for (const name of ['procedure', 'stream']) {
        const result = await client.callTool({ name })

        expect(parseToolError(result)).toEqual(expect.objectContaining({ code: 'CONFLICT', data: { log: {} } }))
        expect((result.content as any)[1]).toEqual({
          type: 'resource',
          resource: { uri: 'file:///data/log/log.txt', mimeType: 'text/plain', blob: 'AQID' },
        })
      }
    })

    it('reports output validation errors as internal errors', async () => {
      const client = await createTestClient('legacy', new McpRegistrar({
        procedure: os.output(z.object({ id: z.number() })).handler(() => ({ id: 'invalid' }) as any),
      }))

      const result = await client.callTool({ name: 'procedure' })

      expect(parseToolError(result)).toEqual(expect.objectContaining({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Output validation failed',
      }))
    })
  })

  describe('context', () => {
    const procedure = os
      .$context<{ auth?: string }>()
      .handler(({ context }) => context.auth ?? 'anonymous')

    it('resolves the initial context from the MCP request context', async () => {
      const context = vi.fn((ctx: ServerContext) => ({ auth: ctx.http?.req?.headers.get('authorization') ?? undefined }))

      const client = await createTestClient('modern', new McpRegistrar({ procedure }), {
        context,
        requestInit: { headers: { authorization: 'Bearer token' } },
      })

      const result = await client.callTool({ name: 'procedure' })

      expect(result.content).toEqual([{ type: 'text', text: 'Bearer token' }])
      expect(context).toHaveBeenCalledWith(expect.objectContaining({
        mcpReq: expect.objectContaining({ method: 'tools/call', signal: expect.any(AbortSignal) }),
      }))
    })

    it('uses the context of the server a tool is registered on', async () => {
      const registrar = new McpRegistrar({ procedure })

      const { tools: first } = await registrar.register(createTestServer(), { context: { auth: 'first' } })
      const { tools: second } = await registrar.register(createTestServer(), { context: async () => ({ auth: 'second' }) })
      const { tools: anonymous } = await registrar.register(createTestServer())

      const ctx = { mcpReq: { signal: new AbortController().signal } } as any

      expect(await first.procedure!.handler({} as any, ctx)).toEqual(expect.objectContaining({ content: [{ type: 'text', text: 'first' }] }))
      expect(await second.procedure!.handler({} as any, ctx)).toEqual(expect.objectContaining({ content: [{ type: 'text', text: 'second' }] }))
      expect(await anonymous.procedure!.handler({} as any, ctx)).toEqual(expect.objectContaining({ content: [{ type: 'text', text: 'anonymous' }] }))
    })

    it.each(['legacy', 'auto'] as const)('provides per-request context from the createMcpHandler factory (%s negotiation)', async (mode) => {
      const registrar = new McpRegistrar({ procedure })

      const handler = createMcpHandler(async ({ authInfo }) => {
        const server = createTestServer()
        await registrar.register(server, { context: { auth: authInfo?.extra?.user as string } })
        return server
      })
      onTestFinished(() => handler.close())

      const callAs = async (user: string) => {
        const client = new Client({ name: 'test-client', version: '1.0.0' }, { versionNegotiation: { mode } })
        onTestFinished(() => client.close())

        await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
          fetch: (url, init) => handler.fetch(new Request(url, init), {
            authInfo: { token: user, clientId: 'test-client', scopes: [], extra: { user } },
          }),
        }))

        return client.callTool({ name: 'procedure' })
      }

      expect((await callAs('alice')).content).toEqual([{ type: 'text', text: 'alice' }])
      expect((await callAs('bob')).content).toEqual([{ type: 'text', text: 'bob' }])
    })
  })

  describe('standard handler', () => {
    it('runs client interceptors with the procedure path and forwards the abort signal', async () => {
      const interceptor = vi.fn(({ next }) => next())
      const handler = vi.fn(() => 'ok')

      const client = await createTestClient('legacy', new McpRegistrar({
        planet: { ping: os.handler(handler) },
      }, { clientInterceptors: [interceptor] }))

      await client.callTool({ name: 'planet_ping' })

      expect(interceptor).toHaveBeenCalledTimes(1)
      expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({
        path: ['planet', 'ping'],
        signal: expect.any(AbortSignal),
      }))
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }), {})
    })

    it('runs plugins and interceptors around every tool call, with a request for the tool call', async () => {
      const routingInterceptor = vi.fn(({ next }) => next())
      const interceptor = vi.fn(({ next }) => next())
      const init = vi.fn(options => ({ ...options, interceptors: [interceptor, ...(options.interceptors ?? [])] }))

      const client = await createTestClient('legacy', new McpRegistrar({
        planet: { find: os.$context<{ auth: string }>().input(z.object({ id: z.number() })).handler(({ input, context }) => `${context.auth} ${input.id}`) },
      }, { routingInterceptors: [routingInterceptor], plugins: [{ name: 'test', init }] }), { context: { auth: 'token' } })

      expect((await client.callTool({ name: 'planet_find', arguments: { id: 1 } })).content).toEqual([{ type: 'text', text: 'token 1' }])
      expect(init).toHaveBeenCalledTimes(1)

      const { request, context } = routingInterceptor.mock.calls[0]![0]
      expect(request).toEqual(expect.objectContaining({ method: 'POST', url: '/planet/find', headers: {}, signal: expect.any(AbortSignal) }))
      expect(await request.resolveBody()).toEqual({ id: 1 })
      expect(context).toEqual(expect.objectContaining({ auth: 'token' }))

      expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({ path: ['planet', 'find'] }))
    })

    it('carries the trace context of tool calls over as request headers', async () => {
      const routingInterceptor = vi.fn(({ next }) => next())

      const client = await createTestClient('legacy', new McpRegistrar({ ping: os.handler(() => 'pong') }, { routingInterceptors: [routingInterceptor] }))

      await client.callTool({
        name: 'ping',
        _meta: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', tracestate: 'vendor=1', baggage: 'user=alice', other: 'value' },
      })

      expect(routingInterceptor.mock.calls[0]![0].request.headers).toEqual({
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        tracestate: 'vendor=1',
        baggage: 'user=alice',
      })
    })

    it.each([
      ['an interceptor', {
        interceptors: [() => {
          throw new ORPCError('UNAUTHORIZED')
        }],
      }, {}, 'UNAUTHORIZED'],
      ['a routing interceptor that does not match', { routingInterceptors: [async () => ({ matched: false })] }, {}, 'NOT_FOUND'],
      // tool calls are routed by the procedure path
      ['a routing interceptor that changes the URL', { routingInterceptors: [({ next, request }: any) => next({ request: { ...request, url: '/unknown' } })] }, {}, 'NOT_FOUND'],
      ['the context', {}, {
        context: () => {
          throw new Error('context failed')
        },
      }, 'INTERNAL_SERVER_ERROR'],
    ])('reports errors from %s as tool execution errors', async (_, options: any, registerOptions: any, code) => {
      const client = await createTestClient('legacy', new McpRegistrar({ procedure: os.handler(() => 'ok') }, options), registerOptions)

      expect(parseToolError(await client.callTool({ name: 'procedure' }))).toEqual(expect.objectContaining({ code }))
    })
  })

  describe('contract-first', () => {
    const contract = {
      planet: {
        find: oc
          .meta(openapi({ method: 'GET', summary: 'Find a planet' }))
          .input(z.object({ id: z.number() }))
          .output(planetSchema),
      },
    }

    it('registers implemented contracts with the contract meta', async () => {
      const os = implement(contract)

      const implemented = os.router({
        planet: {
          find: os.planet.find.handler(({ input }) => ({ id: input.id, name: 'Earth' })),
        },
      })

      const client = await createTestClient('legacy', new McpRegistrar(implemented))

      const { tools } = await client.listTools()
      expect(tools).toEqual([expect.objectContaining({ name: 'planet_find', title: 'Find a planet', annotations: { readOnlyHint: true } })])

      const result = await client.callTool({ name: 'planet_find', arguments: { id: 1 } })
      expect(result.structuredContent).toEqual({ id: 1, name: 'Earth' })
    })

    it('resolves lazy implementations', async () => {
      const os = implement(contract)

      const implemented = os.router({
        planet: os.planet.lazy(() => Promise.resolve({
          default: os.planet.router({
            find: os.planet.find.handler(({ input }) => ({ id: input.id, name: 'Mars' })),
          }),
        })),
      })

      const client = await createTestClient('legacy', new McpRegistrar(implemented))

      const result = await client.callTool({ name: 'planet_find', arguments: { id: 2 } })
      expect(result.structuredContent).toEqual({ id: 2, name: 'Mars' })
    })

    it('throws when an implementation is missing', async () => {
      const server = createTestServer()
      const implemented = implement(contract).router({ planet: {} } as any)

      await expect(new McpRegistrar(implemented).register(server)).rejects.toThrow(
        '[Contract-First] Missing or invalid implementation for procedure at path: "planet.find".',
      )
    })
  })

  describe('register', () => {
    it('loads the router once and builds tool definitions on every registration', async () => {
      const convert = vi.fn((_schema: unknown, _direction: string): [any, boolean] => [{ type: 'object', properties: { id: { type: 'number' } } }, false])
      const converter: JsonSchemaConverter = { condition: () => true, convert }
      const loader = vi.fn(() => Promise.resolve({
        default: {
          procedure: os
            .input(z.object({ id: z.number() }))
            .output(z.object({ id: z.number() }))
            .handler(({ input }) => input),
        },
      }))

      const registrar = new McpRegistrar({ planet: os.lazy(loader) }, { converters: [converter] })

      await registrar.register(createTestServer())
      await registrar.register(createTestServer())

      expect(loader).toHaveBeenCalledTimes(1)
      // input schemas are converted once for decoding, output schemas once per registration
      expect(convert.mock.calls.filter(([, direction]) => direction === 'input')).toHaveLength(1)
      expect(convert.mock.calls.filter(([, direction]) => direction === 'output')).toHaveLength(2)
    })

    it('loads a lazy router again on the next registration after a failure', async () => {
      const loader = vi.fn()
        .mockRejectedValueOnce(new Error('failed to load'))
        .mockResolvedValue({ default: { ping: os.handler(() => 'pong') } })

      const registrar = new McpRegistrar({ planet: os.lazy(loader) })

      await expect(registrar.register(createTestServer())).rejects.toThrow('failed to load')
      expect(Object.keys((await registrar.register(createTestServer())).tools)).toEqual(['planet_ping'])
      expect(loader).toHaveBeenCalledTimes(2)
    })

    it('registers on multiple servers', async () => {
      const registrar = new McpRegistrar(router)

      const { tools: first } = await registrar.register(createTestServer())
      const { tools: second } = await registrar.register(createTestServer())

      expect(Object.keys(first)).toEqual(Object.keys(second))
      expect(first.planet_list).not.toBe(second.planet_list)
    })
  })
})
