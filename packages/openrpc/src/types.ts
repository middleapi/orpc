import type { JsonSchema } from '@orpc/json-schema'

/**
 * `x-` specification extensions, allowed on most OpenRPC objects.
 */
export type OpenRPCExtensions = { [K in `x-${string}`]?: unknown }

export interface OpenRPCReferenceObject {
  $ref: string
}

export interface OpenRPCExternalDocumentationObject extends OpenRPCExtensions {
  url: string
  description?: string | undefined
}

export interface OpenRPCTagObject extends OpenRPCExtensions {
  name: string
  description?: string | undefined
  externalDocs?: OpenRPCExternalDocumentationObject | undefined
}

export interface OpenRPCContentDescriptorObject extends OpenRPCExtensions {
  name: string
  summary?: string | undefined
  description?: string | undefined
  required?: boolean | undefined
  schema: JsonSchema
  deprecated?: boolean | undefined
}

export interface OpenRPCErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface OpenRPCServerObject extends OpenRPCExtensions {
  url: string
  name?: string | undefined
  summary?: string | undefined
  description?: string | undefined
  variables?: Record<string, { default: string, enum?: string[] | undefined, description?: string | undefined }> | undefined
}

export interface OpenRPCMethodObject extends OpenRPCExtensions {
  name: string
  tags?: (OpenRPCTagObject | OpenRPCReferenceObject)[] | undefined
  summary?: string | undefined
  description?: string | undefined
  externalDocs?: OpenRPCExternalDocumentationObject | undefined
  params: (OpenRPCContentDescriptorObject | OpenRPCReferenceObject)[]
  result?: OpenRPCContentDescriptorObject | OpenRPCReferenceObject | undefined
  deprecated?: boolean | undefined
  servers?: OpenRPCServerObject[] | undefined
  errors?: (OpenRPCErrorObject | OpenRPCReferenceObject)[] | undefined
  paramStructure?: 'by-name' | 'by-position' | 'either' | undefined
  links?: unknown[] | undefined
  examples?: unknown[] | undefined
}

export interface OpenRPCComponentsObject extends OpenRPCExtensions {
  schemas?: Record<string, JsonSchema> | undefined
  contentDescriptors?: Record<string, OpenRPCContentDescriptorObject> | undefined
  errors?: Record<string, OpenRPCErrorObject> | undefined
  tags?: Record<string, OpenRPCTagObject> | undefined
  examples?: Record<string, unknown> | undefined
  links?: Record<string, unknown> | undefined
  examplePairings?: Record<string, unknown> | undefined
}

export interface OpenRPCInfoObject extends OpenRPCExtensions {
  title: string
  version: string
  description?: string | undefined
  termsOfService?: string | undefined
  contact?: { name?: string | undefined, url?: string | undefined, email?: string | undefined } | undefined
  license?: { name?: string | undefined, url?: string | undefined } | undefined
}

/**
 * An [OpenRPC](https://spec.open-rpc.org) document.
 */
export interface OpenRPCDocument extends OpenRPCExtensions {
  openrpc: string
  info: OpenRPCInfoObject
  servers?: OpenRPCServerObject[] | undefined
  methods: (OpenRPCMethodObject | OpenRPCReferenceObject)[]
  components?: OpenRPCComponentsObject | undefined
  externalDocs?: OpenRPCExternalDocumentationObject | undefined
}
