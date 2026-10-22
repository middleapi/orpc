import type { JsonSchema } from '@orpc/json-schema'

/**
 * `x-` prefixed fields, allowed on every object whose meta-schema permits them.
 */
export type OpenRPCSpecificationExtensions = { [K in `x-${string}`]?: unknown }

/**
 * A JSON Schema (draft-07) describing params, results, and components.
 */
export type OpenRPCSchemaObject = JsonSchema

/**
 * A reference to a component, e.g. `{ $ref: '#/components/schemas/Planet' }`.
 */
export interface OpenRPCReferenceObject {
  $ref: string
}

/**
 * An OpenRPC 1.3/1.4 document.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#openrpc-generator | OpenRPC Specification - OpenRPC Generator}
 */
export interface OpenRPCDocument extends OpenRPCSpecificationExtensions {
  openrpc: string
  info: OpenRPCInfoObject
  servers?: OpenRPCServerObject[]
  methods: (OpenRPCMethodObject | OpenRPCReferenceObject)[]
  components?: OpenRPCComponentsObject
  externalDocs?: OpenRPCExternalDocumentationObject
  $schema?: string
}

export interface OpenRPCInfoObject extends OpenRPCSpecificationExtensions {
  title: string
  description?: string
  termsOfService?: string
  contact?: OpenRPCContactObject
  license?: OpenRPCLicenseObject
  version: string
}

export interface OpenRPCContactObject extends OpenRPCSpecificationExtensions {
  name?: string
  url?: string
  email?: string
}

export interface OpenRPCLicenseObject extends OpenRPCSpecificationExtensions {
  name?: string
  url?: string
}

export interface OpenRPCServerObject extends OpenRPCSpecificationExtensions {
  name?: string
  url: string
  summary?: string
  description?: string
  variables?: Record<string, OpenRPCServerVariableObject>
}

export interface OpenRPCServerVariableObject extends OpenRPCSpecificationExtensions {
  default: string
  enum?: string[]
  description?: string
}

/**
 * Describes one JSON-RPC method.
 *
 * @see {@link https://orpc.dev/docs/openrpc/specification#metadata | OpenRPC Specification - Metadata}
 */
export interface OpenRPCMethodObject extends OpenRPCSpecificationExtensions {
  name: string
  tags?: (OpenRPCTagObject | OpenRPCReferenceObject)[]
  summary?: string
  description?: string
  externalDocs?: OpenRPCExternalDocumentationObject
  params: (OpenRPCContentDescriptorObject | OpenRPCReferenceObject)[]
  result?: OpenRPCContentDescriptorObject | OpenRPCReferenceObject
  deprecated?: boolean
  servers?: OpenRPCServerObject[]
  errors?: (OpenRPCErrorObject | OpenRPCReferenceObject)[]
  links?: (OpenRPCLinkObject | OpenRPCReferenceObject)[]
  paramStructure?: 'by-name' | 'by-position' | 'either'
  examples?: (OpenRPCExamplePairingObject | OpenRPCReferenceObject)[]
}

export interface OpenRPCContentDescriptorObject extends OpenRPCSpecificationExtensions {
  name: string
  summary?: string
  description?: string
  required?: boolean
  schema: OpenRPCSchemaObject
  deprecated?: boolean
}

/**
 * An application-defined error a method may return. The meta-schema forbids extra (including `x-`) fields.
 */
export interface OpenRPCErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface OpenRPCExamplePairingObject extends OpenRPCSpecificationExtensions {
  name: string
  summary?: string
  description?: string
  params: (OpenRPCExampleObject | OpenRPCReferenceObject)[]
  result?: OpenRPCExampleObject | OpenRPCReferenceObject
}

export interface OpenRPCExampleObject extends OpenRPCSpecificationExtensions {
  name: string
  summary?: string
  description?: string
  value: unknown
}

export interface OpenRPCLinkObject extends OpenRPCSpecificationExtensions {
  name?: string
  summary?: string
  description?: string
  method?: string
  params?: Record<string, unknown>
  server?: OpenRPCServerObject
}

export interface OpenRPCComponentsObject extends OpenRPCSpecificationExtensions {
  schemas?: Record<string, OpenRPCSchemaObject>
  contentDescriptors?: Record<string, OpenRPCContentDescriptorObject>
  examples?: Record<string, OpenRPCExampleObject>
  links?: Record<string, OpenRPCLinkObject>
  errors?: Record<string, OpenRPCErrorObject>
  examplePairings?: Record<string, OpenRPCExamplePairingObject>
  tags?: Record<string, OpenRPCTagObject>
}

/**
 * The meta-schema has no `summary` field on tags.
 */
export interface OpenRPCTagObject extends OpenRPCSpecificationExtensions {
  name: string
  description?: string
  externalDocs?: OpenRPCExternalDocumentationObject
}

export interface OpenRPCExternalDocumentationObject extends OpenRPCSpecificationExtensions {
  url: string
  description?: string
}
