import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { JsonSchema as EffectJsonSchema } from 'effect'
import {
  decodeJsonPointerSegment,
  isStandardSchemaOptional,
  JsonSchemaFormat,
  JsonSchemaXNativeType,
  mapJsonSchemaRefs,
  visitJsonSchemaRefs,
} from '@orpc/json-schema'
import { safeDecodeURIComponent, setOwn } from '@orpc/shared'
import { Schema as EffectSchema, SchemaAST, SchemaRepresentation } from 'effect'

export interface EffectSchemaToJsonSchemaConverterOptions extends EffectSchema.ToJsonSchemaOptions {
  /**
   * Caches conversion results in a WeakMap keyed by the Effect schema instance,
   * so converting the same schema again is free.
   *
   * When enabled, repeated conversions return the same JSON schema object,
   * so treat returned schemas as immutable.
   *
   * @default false
   */
  cache?: boolean
}

type Representation = SchemaRepresentation.Representation
type Check = SchemaRepresentation.Check

const X_NATIVE_TYPE_KEY = 'x-native-type'

const DEFS_REF_PREFIX = '#/$defs/'

/**
 * Effect marks the type side of `Schema.Class` with this annotation.
 */
const CLASS_CONSTRUCTOR_ANNOTATION_KEY = '~constructor'

const defaultReferencePolicy: SchemaRepresentation.ReferencePolicy = ({ identifier }) => identifier

/**
 * Effect describes numbers with a string branch for `NaN` and `Infinity`, which only its JSON codec accepts.
 * A number fragment collapses that branch.
 */
const NUMBER_CHECK = jsonSchemaCheck(() => ({ type: 'number' }))
const BIGINT_CHECK = jsonSchemaCheck(() => ({ pattern: '^-?[0-9]+$' }))
const UNIQUE_ITEMS_CHECK = jsonSchemaCheck(() => ({ uniqueItems: true }))

/**
 * Effect halves string `minLength`, since JavaScript counts UTF-16 code units while JSON Schema counts code points.
 * Maps the ids of these checks to the payload key holding the exact value.
 */
const MIN_LENGTH_PAYLOAD_KEYS = new Map([
  ['effect/schema/isMinLength', 'minLength'],
  ['effect/schema/isBetweenLength', 'minimum'],
])

/**
 * Converts Effect schemas into JSON Schema using Effect's built-in JSON Schema compiler,
 * with additional support for types such as `Schema.Date`, `Schema.BigInt`, `Schema.URL`,
 * `Schema.File`, `Schema.ReadonlySet`, and `Schema.ReadonlyMap`.
 *
 * Unlike [`Schema.toJsonSchemaDocument`](https://effect.website/docs/schema/json-schema/),
 * which describes Effect's canonical JSON codec, the generated schema describes the values oRPC validates.
 * Useful with tools such as the OpenAPI Generator.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#json-schema-converter | Effect Integration - JSON Schema Converter}
 */
export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly toJsonSchemaOptions: EffectSchema.ToJsonSchemaOptions
  private readonly cache: undefined | { [d in JsonSchemaConverterDirection]: WeakMap<EffectSchema.Top, [jsonSchema: JsonSchema, optional: boolean]> }

  constructor({ cache, ...toJsonSchemaOptions }: EffectSchemaToJsonSchemaConverterOptions = {}) {
    this.toJsonSchemaOptions = toJsonSchemaOptions

    if (cache) {
      this.cache = { input: new WeakMap(), output: new WeakMap() }
    }
  }

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect' && EffectSchema.isSchema(schema)
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as EffectSchema.Top & AnySchema

    if (this.cache) {
      const cached = this.cache[direction].get(effectSchema)
      if (cached) {
        return cached
      }
    }

    const result = this.convertUncached(effectSchema, direction)

    if (this.cache) {
      this.cache[direction].set(effectSchema, result)
    }

    return result
  }

  private convertUncached(schema: EffectSchema.Top & AnySchema, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    return [this.convertEffect(schema, direction), isStandardSchemaOptional(schema, direction)]
  }

  private convertEffect(schema: EffectSchema.Top, direction: JsonSchemaConverterDirection): JsonSchema {
    const { referencePolicy = defaultReferencePolicy, includeAnnotationKey, ...options } = this.toJsonSchemaOptions
    const requestedReferences = new Set<string>()

    // `Schema.toJsonSchemaDocument` describes the encoded side of `Schema.toCodecJson`, which differs from
    // what oRPC validates (e.g. `null` for optional fields), so the representation is built from the schema itself.
    const document = EffectSchema.toRepresentation(direction === 'input' ? schema : EffectSchema.toType(schema), {
      referencePolicy: (input) => {
        const reference = referencePolicy({ ...input, identifier: resolveIdentifier(input) })
        return reference === undefined ? undefined : claimReference(requestedReferences, reference)
      },
    })

    const { schema: jsonSchema, definitions } = SchemaRepresentation.toJsonSchemaDocument(
      new RepresentationLowering(document, requestedReferences).lowerDocument(),
      {
        ...options,
        includeAnnotationKey: key => key === X_NATIVE_TYPE_KEY || includeAnnotationKey?.(key) === true,
      },
    )

    return finalizeJsonSchema(jsonSchema, definitions)
  }
}

/**
 * Effect appends `Encoded` to identifiers inherited from the decoded side of a schema.
 * oRPC converts each direction separately, so the plain identifier is used instead.
 */
function resolveIdentifier({ ast, identifier }: SchemaRepresentation.ReferencePolicyInput): string | undefined {
  return identifier !== undefined && identifier.endsWith('Encoded') && SchemaAST.resolveIdentifier(ast) !== identifier
    ? identifier.slice(0, -'Encoded'.length)
    : identifier
}

/**
 * Keeps requested reference names unique, so Effect never suffixes them
 * and every other reference is known to be named by Effect.
 */
function claimReference(claimed: Set<string>, reference: string): string {
  let name = reference

  for (let i = 2; claimed.has(name); i++) {
    name = `${reference}${i}`
  }

  claimed.add(name)
  return name
}

/**
 * Creates a check that only contributes a JSON Schema fragment, which Effect's compiler merges into its schema.
 */
function jsonSchemaCheck(fragment: () => EffectJsonSchema.JsonSchema): SchemaRepresentation.Filter {
  return { _tag: 'Filter', aborted: false, annotations: { toJsonSchema: fragment } }
}

/**
 * Adds annotations and checks to a representation, wrapping references that cannot carry them.
 */
function withAnnotationsAndChecks(
  representation: Representation,
  annotations: EffectSchema.Annotations.Annotations | undefined,
  checks: Check[],
): Representation {
  if (annotations === undefined && checks.length === 0) {
    return representation
  }

  if (representation._tag === 'Reference') {
    // Effect compiles a suspended reference as the reference plus the suspension's annotations and checks
    return { _tag: 'Suspend', thunk: representation, checks: checks as [], annotations }
  }

  return {
    ...representation,
    checks: [...representation.checks, ...checks] as [],
    annotations: annotations === undefined ? representation.annotations : { ...representation.annotations, ...annotations },
  }
}

/**
 * Replaces the halved string `minLength` of Effect's length checks with the exact value.
 */
function withExactMinLength(check: SchemaRepresentation.Filter): EffectSchema.Annotations.Annotations | undefined {
  const payloadKey = check.representation && MIN_LENGTH_PAYLOAD_KEYS.get(check.representation.id)
  const payload = check.representation?.payload
  const minLength = payloadKey && typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[payloadKey] : undefined
  const toJsonSchema = check.annotations?.toJsonSchema as SchemaRepresentation.ToJsonSchema.Check | undefined

  if (typeof minLength !== 'number' || typeof toJsonSchema !== 'function') {
    return check.annotations
  }

  const exactToJsonSchema: SchemaRepresentation.ToJsonSchema.Check = (input) => {
    const output = toJsonSchema(input)

    if (input.type !== 'string') {
      return output
    }

    return Array.isArray(output) ? [{ ...output[0], minLength }, true] : { ...output, minLength }
  }

  return { ...check.annotations, toJsonSchema: exactToJsonSchema }
}

/**
 * Drops definitions the schema never references (e.g. ones only used by unconstrained declarations),
 * and decodes the percent-encoded `$ref`s Effect emits, since oRPC uses plain JSON pointers.
 */
function finalizeJsonSchema(schema: EffectJsonSchema.JsonSchema, definitions: EffectJsonSchema.Definitions): JsonSchema {
  const reachable = new Set<string>()
  const pending: JsonSchema[] = [schema as JsonSchema]
  let hasEncodedRef = false

  for (let i = 0; i < pending.length; i++) {
    visitJsonSchemaRefs(pending[i]!, (ref) => {
      hasEncodedRef ||= ref.includes('%')

      if (!ref.startsWith(DEFS_REF_PREFIX)) {
        return
      }

      const name = decodeJsonPointerSegment(safeDecodeURIComponent(ref.slice(DEFS_REF_PREFIX.length).split('/')[0]!))

      if (!reachable.has(name) && Object.hasOwn(definitions, name)) {
        reachable.add(name)
        pending.push(definitions[name] as JsonSchema)
      }
    })
  }

  const decodeRefs = (schema: JsonSchema): JsonSchema => hasEncodedRef
    ? mapJsonSchemaRefs(schema, ref => ref.startsWith('#') ? `#${safeDecodeURIComponent(ref.slice(1))}` : ref)
    : schema

  const root = decodeRefs(schema as JsonSchema)

  if (reachable.size === 0) {
    return root
  }

  const $defs: Record<string, JsonSchema> = {}

  for (const name of Object.keys(definitions)) {
    if (reachable.has(name)) {
      setOwn($defs, name, decodeRefs(definitions[name] as JsonSchema))
    }
  }

  return { ...root as Exclude<JsonSchema, boolean>, $defs }
}

/**
 * Rewrites a representation document to describe the values oRPC validates and sends,
 * rather than the values Effect's JSON codec accepts.
 */
class RepresentationLowering {
  private readonly referenceNames = new Map<string, string>()
  private readonly lowered = new Map<Representation, Representation>()

  constructor(
    private readonly document: SchemaRepresentation.Document,
    requestedReferences: ReadonlySet<string>,
  ) {
    let syntheticIndex = 0

    for (const reference of Object.keys(document.references)) {
      let name = reference

      // Effect names unnamed recursive schemas after their AST node (e.g. `Objects_`), use the oRPC convention instead
      if (!requestedReferences.has(reference)) {
        do {
          name = `__schema${syntheticIndex++}`
        } while (requestedReferences.has(name))
      }

      this.referenceNames.set(reference, name)
    }
  }

  lowerDocument(): SchemaRepresentation.Document {
    const references: Record<string, Representation> = {}

    for (const reference of Object.keys(this.document.references)) {
      setOwn(references, this.referenceNames.get(reference)!, this.lower(this.document.references[reference]!))
    }

    return { representation: this.lower(this.document.representation), references }
  }

  private lower(representation: Representation): Representation {
    let result = this.lowered.get(representation)

    if (result === undefined) {
      result = this.lowerUncached(representation)
      this.lowered.set(representation, result)
    }

    return result
  }

  private lowerUncached(representation: Representation): Representation {
    switch (representation._tag) {
      case 'Reference':
        return { _tag: 'Reference', $ref: this.referenceNames.get(representation.$ref) ?? representation.$ref }
      case 'Undefined':
      case 'Void':
      case 'Symbol':
      case 'UniqueSymbol':
        // oRPC serializers drop or nullify these values, so they cannot be described
        return { _tag: 'Unknown', checks: this.lowerChecks(representation.checks), annotations: representation.annotations }
      case 'Number':
        return { ...representation, checks: [NUMBER_CHECK, ...this.lowerChecks(representation.checks)] }
      case 'BigInt':
        return {
          _tag: 'String',
          checks: [BIGINT_CHECK, ...this.lowerChecks(representation.checks)],
          annotations: { [X_NATIVE_TYPE_KEY]: JsonSchemaXNativeType.BigInt, ...representation.annotations },
        }
      case 'Literal':
        return {
          ...representation,
          checks: this.lowerChecks(representation.checks),
          annotations: typeof representation.literal === 'bigint'
            ? { [X_NATIVE_TYPE_KEY]: JsonSchemaXNativeType.BigInt, ...representation.annotations }
            : representation.annotations,
        }
      case 'Declaration':
        return this.lowerDeclaration(representation)
      case 'Suspend':
        return { ...representation, thunk: this.lower(representation.thunk) }
      case 'Arrays':
        return {
          ...representation,
          elements: representation.elements.map(element => ({ ...element, type: this.lower(element.type) })),
          rest: representation.rest.map(rest => this.lower(rest)),
          checks: this.lowerChecks(representation.checks),
        }
      case 'Objects':
        return {
          ...representation,
          propertySignatures: representation.propertySignatures.map(property => ({ ...property, type: this.lower(property.type) })),
          indexSignatures: representation.indexSignatures.map(signature => ({
            parameter: this.lowerIndexParameter(signature.parameter),
            type: this.lower(signature.type),
          })),
          checks: this.lowerChecks(representation.checks),
        }
      case 'Union':
        return this.lowerUnion(representation)
      default:
        return { ...representation, checks: this.lowerChecks(representation.checks) }
    }
  }

  private lowerUnion(union: SchemaRepresentation.Union): Representation {
    const checks = this.lowerChecks(union.checks)
    // `undefined` is omitted from objects and sent as `null` elsewhere, which the schema rejects either way
    const types = union.types.filter(type => type._tag !== 'Undefined' && type._tag !== 'Void').map(type => this.lower(type))

    if (types.length === 0) {
      return { _tag: 'Unknown', checks, annotations: union.annotations }
    }

    if (types.length === 1 && union.types.length > 1) {
      return withAnnotationsAndChecks(types[0]!, union.annotations, checks)
    }

    return { ...union, types, checks }
  }

  private lowerDeclaration(declaration: SchemaRepresentation.Declaration): Representation {
    const checks = this.lowerChecks(declaration.checks)
    const [first, second] = declaration.typeParameters

    switch (declaration.representation?.id) {
      case 'effect/schema/Date':
        return {
          _tag: 'String',
          checks,
          annotations: { format: JsonSchemaFormat.DateTime, [X_NATIVE_TYPE_KEY]: JsonSchemaXNativeType.Date, ...declaration.annotations },
        }
      case 'effect/schema/URL':
        return {
          _tag: 'String',
          checks,
          annotations: { format: JsonSchemaFormat.URI, [X_NATIVE_TYPE_KEY]: JsonSchemaXNativeType.Url, ...declaration.annotations },
        }
      case 'effect/schema/File':
        // Matches the file schemas of the other converters, which OpenAPI tooling sends as binary
        return {
          _tag: 'String',
          checks,
          annotations: { format: 'binary', contentEncoding: 'binary', ...declaration.annotations },
        }
      case 'effect/schema/ReadonlySet':
        if (first) {
          return {
            _tag: 'Arrays',
            elements: [],
            rest: [this.lower(first)],
            checks: [UNIQUE_ITEMS_CHECK, ...checks],
            annotations: { [X_NATIVE_TYPE_KEY]: JsonSchemaXNativeType.Set, ...declaration.annotations },
          }
        }
        break
      case 'effect/schema/ReadonlyMap':
        if (first && second) {
          return {
            _tag: 'Arrays',
            elements: [],
            rest: [{
              _tag: 'Arrays',
              elements: [{ isOptional: false, type: this.lower(first) }, { isOptional: false, type: this.lower(second) }],
              rest: [],
              checks: [],
            }],
            checks,
            annotations: { [X_NATIVE_TYPE_KEY]: JsonSchemaXNativeType.Map, ...declaration.annotations },
          }
        }
        break
    }

    // The type side of `Schema.Class` declares an instance of its fields, which are what reach the wire
    if (first && declaration.typeParameters.length === 1 && declaration.annotations?.[CLASS_CONSTRUCTOR_ANNOTATION_KEY] !== undefined) {
      return withAnnotationsAndChecks(this.lower(first), declaration.annotations, checks)
    }

    // Other declarations (e.g. `Option`, `Duration`, `Uint8Array`) have no oRPC wire format,
    // so they keep the unconstrained JSON Schema Effect compiles them to
    return { ...declaration, checks }
  }

  private lowerIndexParameter(parameter: Representation): Representation {
    switch (parameter._tag) {
      case 'Number':
        // Object keys are strings, so number keys are numeric strings
        return { _tag: 'TemplateLiteral', parts: [{ _tag: 'Number', checks: [] }], checks: this.lowerChecks(parameter.checks), annotations: parameter.annotations }
      case 'Symbol':
      case 'UniqueSymbol':
        // No key of a JSON object is a symbol, so these index signatures select nothing
        return { _tag: 'String', checks: [{ _tag: 'Filter', aborted: false }] }
      case 'Union':
        return { ...parameter, types: parameter.types.map(type => this.lowerIndexParameter(type)), checks: this.lowerChecks(parameter.checks) }
      default:
        return this.lower(parameter)
    }
  }

  private lowerChecks(checks: readonly Check[]): Check[] {
    return checks.map(check => this.lowerCheck(check))
  }

  private lowerCheck(check: Check): Check {
    const representation = check.representation?.schemas
      ? { ...check.representation, schemas: check.representation.schemas.map(schema => this.lower(schema)) }
      : check.representation

    if (check._tag === 'FilterGroup') {
      return { ...check, representation, checks: check.checks.map(check => this.lowerCheck(check)) as [Check, ...Check[]] }
    }

    return { ...check, representation, annotations: withExactMinLength(check) }
  }
}
