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
        if (isObjectJsonSchema(outputSchema)) {
          definition.outputSchema = outputSchema
        }
      }
      if (meta.annotations !== undefined) {
        definition.annotations = { ...meta.annotations }
      }

      registry.tools.set(name, { definition, procedure, meta })
    }
    else if (type === 'resource') {
      if (meta.uriTemplate !== undefined) {
        const definition: ResourceTemplateDefinition = { uriTemplate: meta.uriTemplate, name }
        applyResourceMeta(definition, meta)
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
  if (isObjectJsonSchema(schema)) {
    return schema
  }
  // MCP requires inputSchema to be a JSON Schema object; fall back to an empty
  // object schema when the procedure has no (object) input.
  return { type: 'object' }
}

async function toPromptArguments(
  converter: Pick<JsonSchemaConverter, 'convert'>,
  schemas: unknown,
): Promise<PromptArgument[]> {
  const [schema] = await convertSchemas(converter, schemas, 'input')
  if (!isObjectJsonSchema(schema) || !isPlainRecord(schema.properties)) {
    return []
  }

  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.entries(schema.properties).map(([argName, prop]) => {
    const argument: PromptArgument = { name: argName, required: required.has(argName) }
    if (isPlainRecord(prop) && typeof prop.description === 'string') {
      argument.description = prop.description
    }
    return argument
  })
}
