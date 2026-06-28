import { os } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import * as z from 'zod'
import { mcp } from './meta'
import { buildMCPRegistry } from './registry'

// --- procedures ---

const greet = os
  .meta(mcp.tool({ title: 'Greet', description: 'Greet a person' }))
  .input(z.object({ name: z.string() }))
  .output(z.object({ message: z.string() }))
  .handler(({ input }) => ({ message: `Hello, ${input.name}!` }))

// nested tool with NO explicit name -> default name from path ('planet_list')
const listPlanets = os
  .meta(mcp.tool({ description: 'List planets' }))
  .input(z.object({}))
  .handler(() => [])

// static resource (fixed uri)
const config = os
  .meta(mcp.resource({ uri: 'config://app', mimeType: 'text/plain' }))
  .output(z.string())
  .handler(() => 'debug=true')

// templated resource (uriTemplate)
const planetResource = os
  .meta(mcp.resource({ uriTemplate: 'planet://{id}', mimeType: 'application/json' }))
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .handler(({ input }) => ({ id: input.id, name: `Planet ${input.id}` }))

// prompt (arguments derived from input)
const planTrip = os
  .meta(mcp.prompt({ description: 'Plan a trip' }))
  .input(z.object({ destination: z.string(), days: z.number(), note: z.string().optional() }))
  .handler(() => ({ messages: [] }))

// NOT opted into MCP -> must be excluded entirely
const secret = os.input(z.object({})).handler(() => 'secret')

const router = {
  greet,
  config,
  getPlanet: planetResource,
  planTrip,
  secret,
  planet: { list: listPlanets },
}

const converters = [new ZodToJsonSchemaConverter()]

describe('buildMCPRegistry', () => {
  let registry: Awaited<ReturnType<typeof buildMCPRegistry>>

  beforeAll(async () => {
    registry = await buildMCPRegistry(router, { converters })
  })

  it('keys tools by name and excludes non-mcp procedures everywhere', () => {
    expect(registry.tools.has('greet')).toBe(true)
    expect(registry.tools.get('greet')!.definition.name).toBe('greet')

    // exactly the two MCP tools: greet + the nested planet_list
    expect([...registry.tools.keys()].sort()).toEqual(['greet', 'planet_list'])

    // 'secret' (no mcp meta) appears in no collection
    const allNames = [
      ...[...registry.tools.values()].map(e => e.definition.name),
      ...[...registry.resources.values()].map(e => e.definition.name),
      ...registry.resourceTemplates.map(e => e.definition.name),
      ...[...registry.prompts.values()].map(e => e.definition.name),
    ]
    expect(allNames).not.toContain('secret')
    expect(allNames.sort()).toEqual(['config', 'getPlanet', 'greet', 'planTrip', 'planet_list'])
  })

  it('assigns a nested tool the default name from its path joined by "_"', () => {
    expect(registry.tools.has('planet_list')).toBe(true)
    expect(registry.tools.get('planet_list')!.definition.name).toBe('planet_list')
  })

  it('produces an object inputSchema and an outputSchema only when .output is defined', () => {
    const greetDef = registry.tools.get('greet')!.definition
    expect(greetDef.inputSchema.type).toBe('object')
    expect(greetDef.inputSchema.properties).toHaveProperty('name')

    // greet has .output -> outputSchema present and is an object schema
    expect(greetDef.outputSchema).toBeDefined()
    expect(greetDef.outputSchema!.type).toBe('object')
    expect(greetDef.title).toBe('Greet')
    expect(greetDef.description).toBe('Greet a person')

    // planet_list has no .output -> no outputSchema, but still an object inputSchema
    const listDef = registry.tools.get('planet_list')!.definition
    expect(listDef.inputSchema.type).toBe('object')
    expect(listDef.outputSchema).toBeUndefined()
  })

  it('stores static resources in a Map keyed by their fixed uri', () => {
    expect(registry.resources).toBeInstanceOf(Map)
    expect([...registry.resources.keys()]).toEqual(['config://app'])

    const entry = registry.resources.get('config://app')!
    expect(entry.definition.uri).toBe('config://app')
    expect(entry.definition.name).toBe('config')
    expect(entry.definition.mimeType).toBe('text/plain')
  })

  it('stores templated resources in an array whose compiled template matches concrete uris', () => {
    expect(Array.isArray(registry.resourceTemplates)).toBe(true)
    expect(registry.resourceTemplates).toHaveLength(1)

    const entry = registry.resourceTemplates[0]!
    expect(entry.definition.uriTemplate).toBe('planet://{id}')
    expect(entry.definition.name).toBe('getPlanet')
    expect(entry.definition.mimeType).toBe('application/json')

    expect(entry.template.variables).toEqual(['id'])
    expect(entry.template.match('planet://mars')).toEqual({ id: 'mars' })
    // non-matching uri -> undefined
    expect(entry.template.match('config://app')).toBeUndefined()
  })

  it('derives prompt arguments from input fields with correct required flags', () => {
    expect(registry.prompts.has('planTrip')).toBe(true)
    const promptDef = registry.prompts.get('planTrip')!.definition
    expect(promptDef.description).toBe('Plan a trip')

    expect(promptDef.arguments).toHaveLength(3)
    expect(promptDef.arguments).toEqual(expect.arrayContaining([
      { name: 'destination', required: true },
      { name: 'days', required: true },
      { name: 'note', required: false },
    ]))
  })

  it('rejects a resource that defines neither uri nor uriTemplate', async () => {
    const broken = os
      // typed API requires uri|uriTemplate; cast to exercise the runtime guard
      .meta((mcp.resource as (meta: any) => any)({}))
      .output(z.string())
      .handler(() => 'x')

    await expect(
      buildMCPRegistry({ broken }, { converters }),
    ).rejects.toThrow(/must define a "uri" or "uriTemplate"/)
  })
})
