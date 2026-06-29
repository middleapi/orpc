import type { JsonSchema, JsonSchemaConverter } from '@orpc/json-schema'
import type { AnyProcedure, AnyRouter } from '@orpc/server'
import type { MCPMeta } from './meta'
import type {
  JsonSchemaObject,
  PromptArgument,
  PromptDefinition,
  ResourceDefinition,
  ResourceTemplateDefinition,
  ToolDefinition,
} from './types'
import type { CompiledUriTemplate } from './uri-template'
import { DelegatingJsonSchemaConverter, StandardJsonSchemaConverter } from '@orpc/json-schema'
import { walkProcedureContractsAsync } from '@orpc/server'
import { toArray } from '@orpc/shared'
import { getMCPMeta, getMCPPrimitiveType } from './meta'
import { compileUriTemplate } from './uri-template'

export interface ToolEntry {
  definition: ToolDefinition
  procedure: AnyProcedure
  meta: MCPMeta
}

export interface ResourceEntry {
  definition: ResourceDefinition
  procedure: AnyProcedure
  meta: MCPMeta
}

export interface ResourceTemplateEntry {
  definition: ResourceTemplateDefinition
  template: CompiledUriTemplate
  procedure: AnyProcedure
  meta: MCPMeta
}

export interface PromptEntry {
  definition: PromptDefinition
  procedure: AnyProcedure
  meta: MCPMeta
}

export interface MCPRegistry {
  tools: Map<string, ToolEntry>
  /** Static resources keyed by their fixed URI. */
  resources: Map<string, ResourceEntry>
  /** Templated resources (matched in order). */
  resourceTemplates: ResourceTemplateEntry[]
  prompts: Map<string, PromptEntry>
}

export interface BuildMCPRegistryOptions {
  /** Schema → JSON Schema converters (e.g. `new ZodToJsonSchemaConverter()`). */
  converters?: JsonSchemaConverter[]
}

/**
 * Walk a router and collect every procedure opted into MCP (via `mcp()` meta),
 * pre-computing its tool / resource / prompt definition. Resolves lazy routers.
 */
export async function buildMCPRegistry(
  router: AnyRouter,
  options: BuildMCPRegistryOptions = {},
): Promise<MCPRegistry> {
  const converter = new DelegatingJsonSchemaConverter([
    ...toArray(options.converters),
    new StandardJsonSchemaConverter(),
  ])

  const registry: MCPRegistry = {
    tools: new Map(),
    resources: new Map(),
    resourceTemplates: [],
    prompts: new Map(),
  }

  await walkProcedureContractsAsync(router, async (contract, path) => {
    const meta = getMCPMeta(contract)
    if (meta === undefined) {
      return
    }

    const procedure = contract as AnyProcedure
    const def = procedure['~orpc']
    const name = meta.name ?? defaultName(path)
    const type = getMCPPrimitiveType(meta)

    if (type === 'tool') {
      const definition: ToolDefinition = {
        name,
        inputSchema: await toInputObjectSchema(converter, def.inputSchemas),
      }
      if (meta.title !== undefined) {
        definition.title = meta.title
      }
      if (meta.description !== undefined) {
        definition.description = meta.description
      }

      const wantsOutput = meta.outputSchema ?? true
      if (wantsOutput && toArray(def.outputSchemas).length > 0) {
        const [outputSchema] = await convertSchemas(converter, def.outputSchemas, 'output')
        const objectSchema = asObjectJsonSchema(outputSchema)
        if (objectSchema !== undefined) {
          definition.outputSchema = objectSchema
        }
      }
      if (meta.annotations !== undefined) {
        definition.annotations = { ...meta.annotations }
      }

      if (registry.tools.has(name)) {
        throw new Error(`Duplicate MCP tool name "${name}" (from ${path.join('.')}). Names must be unique — set a distinct \`name\` in mcp.tool().`)
      }
      registry.tools.set(name, { definition, procedure, meta })
    }
    else if (type === 'resource') {
      if (meta.uriTemplate !== undefined) {
        const definition: ResourceTemplateDefinition = { uriTemplate: meta.uriTemplate, name }
        applyResourceMeta(definition, meta)
        if (registry.resourceTemplates.some(entry => entry.definition.uriTemplate === meta.uriTemplate)) {
          throw new Error(`Duplicate MCP resource template "${meta.uriTemplate}" (from ${path.join('.')}). Resource templates must be unique.`)
        }
        registry.resourceTemplates.push({
          definition,
          template: compileUriTemplate(meta.uriTemplate),
          procedure,
          meta,
        })
      }
      else if (meta.uri !== undefined) {
        const definition: ResourceDefinition = { uri: meta.uri, name }
        applyResourceMeta(definition, meta)
        if (registry.resources.has(meta.uri)) {
          throw new Error(`Duplicate MCP resource URI "${meta.uri}" (from ${path.join('.')}). Resource URIs must be unique.`)
        }
        registry.resources.set(meta.uri, { definition, procedure, meta })
      }
      else {
        throw new Error(`MCP resource "${name}" must define a "uri" or "uriTemplate".`)
      }
    }
    else {
      const definition: PromptDefinition = { name }
      if (meta.title !== undefined) {
        definition.title = meta.title
      }
      if (meta.description !== undefined) {
        definition.description = meta.description
      }
      const args = await toPromptArguments(converter, def.inputSchemas)
      if (args.length > 0) {
        definition.arguments = args
      }
      if (registry.prompts.has(name)) {
        throw new Error(`Duplicate MCP prompt name "${name}" (from ${path.join('.')}). Names must be unique — set a distinct \`name\` in mcp.prompt().`)
      }
      registry.prompts.set(name, { definition, procedure, meta })
    }
  })

  return registry
}

/** A lazily-built, memoized MCP registry shared between the codec and the plugin. */
export interface MCPRegistryProvider {
  get: () => Promise<MCPRegistry>
}

export function createMCPRegistryProvider(
  router: AnyRouter,
  options: BuildMCPRegistryOptions = {},
): MCPRegistryProvider {
  let promise: Promise<MCPRegistry> | undefined
  return {
    get: () => (promise ??= buildMCPRegistry(router, options)),
  }
}

function defaultName(path: string[]): string {
  const joined = path.join('_').replace(/[^\w-]/g, '_')
  return joined.length > 0 ? joined.slice(0, 128) : 'unnamed'
}

function applyResourceMeta(
  definition: { title?: string, description?: string, mimeType?: string },
  meta: MCPMeta,
): void {
  if (meta.title !== undefined) {
    definition.title = meta.title
  }
  if (meta.description !== undefined) {
    definition.description = meta.description
  }
  if (meta.mimeType !== undefined) {
    definition.mimeType = meta.mimeType
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isObjectJsonSchema(schema: unknown): schema is JsonSchemaObject {
  return isPlainRecord(schema) && schema.type === 'object'
}

/**
 * Coerce a converted schema to a single object JSON Schema. Handles the `allOf`
 * wrapper {@link convertSchemas} produces when a procedure has multiple input or
 * output schemas, by merging the object members' properties/required.
 */
function asObjectJsonSchema(schema: unknown): JsonSchemaObject | undefined {
  if (isObjectJsonSchema(schema)) {
    return schema
  }
  if (!isPlainRecord(schema) || !Array.isArray(schema.allOf)) {
    return undefined
  }
  const members = schema.allOf.filter(isObjectJsonSchema)
  if (members.length === 0) {
    return undefined
  }
  const properties: Record<string, unknown> = {}
  const required = new Set<string>()
  for (const member of members) {
    if (isPlainRecord(member.properties)) {
      Object.assign(properties, member.properties)
    }
    if (Array.isArray(member.required)) {
      for (const key of member.required) {
        if (typeof key === 'string') {
          required.add(key)
        }
      }
    }
  }
  const merged = { type: 'object', properties } as JsonSchemaObject
  if (required.size > 0) {
    merged.required = [...required]
  }
  return merged
}

async function convertSchemas(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schemas: unknown,
  direction: 'input' | 'output',
): Promise<[JsonSchema, boolean]> {
  const list = toArray(schemas as undefined) as unknown[]
  if (list.length <= 1) {
    return converter.convert(list[0] as never, direction)
  }

  const results = await Promise.all(list.map(schema => converter.convert(schema as never, direction)))
  const allOf = results.map(([schema]) => schema)
  const optional = results.every(([, isOptional]) => isOptional)
  return [{ allOf } as JsonSchema, optional]
}

async function toInputObjectSchema(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schemas: unknown,
): Promise<JsonSchemaObject> {
  const [schema] = await convertSchemas(converter, schemas, 'input')
  // MCP requires inputSchema to be a JSON Schema object; fall back to an empty
  // object schema when the procedure has no (object) input.
  return asObjectJsonSchema(schema) ?? { type: 'object' }
}

async function toPromptArguments(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schemas: unknown,
): Promise<PromptArgument[]> {
  const [schema] = await convertSchemas(converter, schemas, 'input')
  const object = asObjectJsonSchema(schema)
  if (object === undefined || !isPlainRecord(object.properties)) {
    return []
  }

  const required = new Set(Array.isArray(object.required) ? object.required : [])
  return Object.entries(object.properties).map(([argName, prop]) => {
    const argument: PromptArgument = { name: argName, required: required.has(argName) }
    if (isPlainRecord(prop) && typeof prop.description === 'string') {
      argument.description = prop.description
    }
    return argument
  })
}
