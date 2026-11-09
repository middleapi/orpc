import type { JsonSchema, JsonSchemaConverterDirection } from '@orpc/json-schema'
import {
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  ensureJsonSchemaObject,
  getJsonSchemaKeywordKind,
  mapJsonSchemaRefs,
  visitJsonSchemaRefs,
} from '@orpc/json-schema'
import { getOwn, isDeepEqual, isPlainObject, isPlainObjectOrArray, setOwn } from '@orpc/shared'

import type { OpenAPIV3_2 } from './types'

const DEFS_REF_PREFIX = '#/$defs/'
const COMPONENTS_REF_PREFIX = '#/components/schemas/'

/**
 * Replaces characters OpenAPI does not allow in component keys (`^[a-zA-Z0-9._-]+$`) with `_`.
 * Minted names are always valid keys, so refs to them need no JSON Pointer or URI escaping.
 */
function toValidComponentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, '_') || '_'
}

/**
 * Collects reusable schemas into `doc.components.schemas`.
 *
 * Equivalent schemas (including recursive ones) reuse a single component, and different
 * schemas competing for the same name get direction-suffixed or numbered postfixes.
 */
export class OpenAPIComponentRegistry {
  /**
   * The unsanitized name each minted component was requested under, so distinct names
   * that sanitize to the same key (`User Profile`, `User_Profile`) are never merged.
   * Components the registry did not mint are reusable only when the requested name needs
   * no sanitizing, which keeps `base.components` family reuse (`Planet`, `Planet2`) intact.
   */
  private readonly componentSources = new Map<string, string>()

  /**
   * Reuse checks already made, by the def, the content of the def schemas it reaches, and the
   * component. A component is never rewritten once written, so a check made again gives the same
   * result. Keyed by content, not by object, since a converter may change a schema it returned.
   */
  private readonly reuseResults = new Map<string, boolean>()
  /** An id for each def schema content, so the keys stay short */
  private readonly contentIds = new Map<string, number>()

  constructor(
    private readonly doc: OpenAPIV3_2.OpenAPIObject,
    private readonly componentName:
      | ((defName: string, defSchema: JsonSchema) => string)
      | undefined,
  ) {}

  /**
   * Registers `schema` as a component under `preferredName` (or an equivalent/postfixed name)
   * and returns a `$ref` to it.
   */
  register(preferredName: string, schema: Exclude<JsonSchema, boolean>): JsonSchema {
    const { $defs, ...body } = schema

    // the schema can carry its own local $defs, keep the registered name unique among them
    let defName = preferredName
    if ($defs) {
      for (let i = 2; Object.hasOwn($defs, defName); i++) {
        defName = `${preferredName}${i}`
      }
    }

    return this.hoistDefs({
      $defs: { ...$defs, [defName]: body },
      $ref: `${DEFS_REF_PREFIX}${encodeJsonPointerSegment(defName)}`,
    })
  }

  /**
   * Moves a schema's root-level `$defs` into `doc.components.schemas` and rewrites
   * its refs accordingly.
   */
  hoistDefs(schema: JsonSchema, direction?: JsonSchemaConverterDirection): JsonSchema {
    if (typeof schema !== 'object' || !schema.$defs) {
      return schema
    }

    const { $defs, ...rest } = schema
    const defs = new Map<string, Exclude<JsonSchema, boolean>>()

    for (const defName of Object.keys($defs)) {
      const defSchema = $defs[defName]

      if (defSchema !== undefined) {
        defs.set(defName, ensureJsonSchemaObject(defSchema))
      }
    }

    if (defs.size === 0) {
      return schema
    }

    this.doc.components ??= {}
    this.doc.components.schemas ??= {}

    const componentsSchemas = this.doc.components.schemas
    const renameMap = new Map<string, string>()
    const pendingSchemas: { cleanSchema: Exclude<JsonSchema, boolean>; componentName: string }[] =
      []
    const contents = new Map<string, DefContent | null | undefined>()

    for (const [defName, cleanSchema] of defs) {
      const sourceName = this.componentName ? this.componentName(defName, cleanSchema) : defName
      const preferredName = toValidComponentName(sourceName)
      let closureKey: string | null | undefined
      const [componentName, reuseExisting] = resolveComponentName(
        componentsSchemas,
        new Set(renameMap.values()),
        preferredName,
        (name) =>
          (this.componentSources.get(name) ?? preferredName) === sourceName &&
          this.isEquivalentForReuse(
            defName,
            closureKey === undefined
              ? (closureKey = this.getDefClosureKey(defName, defs, contents))
              : closureKey,
            name,
            defs,
            componentsSchemas,
          ),
        direction,
      )

      renameMap.set(defName, componentName)

      if (!reuseExisting) {
        this.componentSources.set(componentName, sourceName)
        pendingSchemas.push({ cleanSchema, componentName })
      }
    }

    for (const { cleanSchema, componentName } of pendingSchemas) {
      setOwn(componentsSchemas, componentName, rewriteComponentSchemaRefs(cleanSchema, renameMap))
    }

    return rewriteComponentSchemaRefs(rest, renameMap)
  }

  /**
   * Whether a def is equivalent to an existing component, so the component can be reused.
   */
  private isEquivalentForReuse(
    defName: string,
    closureKey: string | null,
    componentName: string,
    defs: ReadonlyMap<string, JsonSchema>,
    componentsSchemas: Record<string, any>,
  ): boolean {
    const key = closureKey === null ? undefined : `${closureKey}\0${componentName}`
    let result = key === undefined ? undefined : this.reuseResults.get(key)

    if (result === undefined) {
      const ctx: ReuseComparisonContext = {
        defs,
        componentsSchemas,
        candidateToExistingKeys: new Map(),
        pairedExistingKeys: new Set(),
        visited: new WeakMap(),
        unresolved: false,
      }

      result = areSchemaRefsEquivalentForReuse(
        DEFS_REF_PREFIX + encodeJsonPointerSegment(defName),
        COMPONENTS_REF_PREFIX + componentName,
        ctx,
      )

      // a ref to a missing schema may resolve once more components are written
      if (key !== undefined && !ctx.unresolved) {
        this.reuseResults.set(key, result)
      }
    }

    return result
  }

  /**
   * Identifies a def and the content of the def schemas it reaches through `#/$defs/` refs,
   * which a reuse check compares, or `null` when a schema has no JSON form (a cycle of objects).
   */
  private getDefClosureKey(
    defName: string,
    defs: ReadonlyMap<string, JsonSchema>,
    contents: Map<string, DefContent | null | undefined>,
  ): string | null {
    const names = new Set([defName])
    const ids: string[] = []

    for (const name of names) {
      let content = contents.get(name)

      if (!contents.has(name)) {
        content = this.getDefContent(defs.get(name))
        contents.set(name, content)
      }

      if (content === null) {
        return null
      }

      ids.push(`${name}=${content?.id ?? ''}`)

      for (const ref of content?.refs ?? []) {
        names.add(ref)
      }
    }

    // oxlint-disable-next-line unicorn/no-array-sort
    return `${defName}\0${ids.sort().join('\0')}`
  }

  private getDefContent(schema: JsonSchema | undefined): DefContent | null | undefined {
    if (typeof schema !== 'object') {
      return undefined
    }

    let json: string

    try {
      // an object always has a JSON form, which the replacer checks
      // oxlint-disable-next-line no-restricted-properties
      json = JSON.stringify(schema, assertJsonContent)
    } catch {
      return null
    }

    let id = this.contentIds.get(json)

    if (id === undefined) {
      id = this.contentIds.size
      this.contentIds.set(json, id)
    }

    const refs: string[] = []
    visitJsonSchemaRefs(schema, (ref) => {
      const refName = parseRefName(ref, DEFS_REF_PREFIX)
      if (refName !== undefined) {
        refs.push(refName)
      }
    })

    return { id, refs }
  }

  toOpenAPISchema(
    schema: JsonSchema,
    direction?: JsonSchemaConverterDirection,
  ): OpenAPIV3_2.SchemaObject {
    return ensureJsonSchemaObject(this.hoistDefs(schema, direction))
  }
}

/**
 * Walks a def's name family until it finds an equivalent existing component to reuse or
 * runs out of family members, then fills the first free mintable slot. Equal schemas under
 * unrelated names are never merged: a different name signals a different purpose.
 *
 * The family is the bare name, the direction-suffixed names when the conversion direction
 * is known, then plain numeric postfixes (`Planet`, `PlanetOutput`, `PlanetInput`,
 * `Planet2`, ...). Every member is checked for reuse, including the opposite direction,
 * but new components are only minted under the bare, own-direction, or numeric names.
 */
function resolveComponentName(
  componentsSchemas: Record<string, any>,
  claimedNames: Set<string>,
  preferredName: string,
  isReusable: (componentName: string) => boolean,
  direction: JsonSchemaConverterDirection | undefined,
): [componentName: string, reuseExisting: boolean] {
  let mintName: string | undefined

  for (let i = 1; ; i++) {
    const [componentName, mintable, tail] = componentNameCandidate(preferredName, direction, i)
    const existingSchema = getOwn(componentsSchemas, componentName)

    if (existingSchema === undefined) {
      // a sibling def can claim a slot before its schema is written, keep probing past it
      if (mintable && !claimedNames.has(componentName)) {
        mintName ??= componentName

        if (tail) {
          return [mintName, false]
        }
      }

      continue
    }

    if (isReusable(componentName)) {
      return [componentName, true]
    }
  }
}

function componentNameCandidate(
  preferredName: string,
  direction: JsonSchemaConverterDirection | undefined,
  attempt: number,
): [componentName: string, mintable: boolean, tail: boolean] {
  if (attempt === 1) {
    return [preferredName, true, false]
  }

  if (direction !== undefined) {
    if (attempt === 2) {
      return [`${preferredName}${direction === 'input' ? 'Input' : 'Output'}`, true, false]
    }

    // the opposite direction is only ever reused, never minted
    if (attempt === 3) {
      return [`${preferredName}${direction === 'input' ? 'Output' : 'Input'}`, false, false]
    }

    return [`${preferredName}${attempt - 2}`, true, true]
  }

  return [`${preferredName}${attempt}`, true, true]
}

function definedKeysOf(object: Record<string, unknown>): string[] {
  // `undefined`-valued keys (e.g. `default: undefined`) are stripped during serialization,
  // so they must not affect equivalence against components from serialized documents
  return (
    Object.keys(object)
      .filter((key) => object[key] !== undefined)
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort()
  )
}

/**
 * A `JSON.stringify` replacer throwing on values the reuse check compares otherwise than their JSON
 * form: by identity (a `Date`, a class instance, a function), `NaN`, or `undefined` in an array.
 */
function assertJsonContent(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key]

  if (
    typeof raw === 'function' ||
    typeof raw === 'symbol' ||
    (typeof raw === 'number' && !Number.isFinite(raw)) ||
    (raw === undefined && Array.isArray(this)) ||
    (typeof raw === 'object' && raw !== null && !isPlainObjectOrArray(raw))
  ) {
    throw new TypeError('Not comparable by its JSON form')
  }

  return value
}

/** The content id of a def schema, and the `#/$defs/` names it refers to */
interface DefContent {
  id: number
  refs: string[]
}

interface ReuseComparisonContext {
  defs: ReadonlyMap<string, JsonSchema>
  componentsSchemas: Record<string, any>
  // keys keep their ref prefix: a candidate can point at def X and component X at once
  candidateToExistingKeys: Map<string, string>
  pairedExistingKeys: Set<string>
  visited: WeakMap<object, WeakSet<object>>
  /** Whether a ref to a missing schema was compared */
  unresolved: boolean
}

/**
 * Where a value sits, mirroring how hoisting rewrites refs: only refs in subschemas are
 * rewritten, so literal data (`const`, `default`, `examples`, ...) is compared as is.
 */
type ReusePosition = 'schema' | 'schema-record' | 'data'

function areSchemasEquivalentForReuse(
  candidate: unknown,
  existing: unknown,
  ctx: ReuseComparisonContext,
  position: ReusePosition = 'schema',
): boolean {
  if (candidate === existing) {
    return true
  }

  // Only arrays and plain objects carry schema structure; primitives and values like Date are compared as a whole
  if (!isPlainObjectOrArray(candidate) || !isPlainObjectOrArray(existing)) {
    return isDeepEqual(candidate, existing)
  }

  const seenExisting = ctx.visited.get(candidate)

  if (seenExisting?.has(existing)) {
    return true
  }

  if (seenExisting) {
    seenExisting.add(existing)
  } else {
    ctx.visited.set(candidate, new WeakSet([existing]))
  }

  if (Array.isArray(candidate) || Array.isArray(existing)) {
    if (
      !Array.isArray(candidate) ||
      !Array.isArray(existing) ||
      candidate.length !== existing.length
    ) {
      return false
    }

    return candidate.every((item, index) =>
      areSchemasEquivalentForReuse(item, existing[index], ctx, position),
    )
  }

  return areObjectsEquivalentForReuse(
    candidate as Record<string, unknown>,
    existing as Record<string, unknown>,
    (key, candidateValue, existingValue) => {
      if (position === 'data') {
        return areSchemasEquivalentForReuse(candidateValue, existingValue, ctx, 'data')
      }

      switch (getJsonSchemaKeywordKind(key, candidateValue, position === 'schema')) {
        case 'ref':
          return areRefValuesEquivalentForReuse(candidateValue, existingValue, ctx)
        case 'discriminator':
          return areDiscriminatorsEquivalentForReuse(candidateValue, existingValue, ctx)
        case 'schema':
          return areSchemasEquivalentForReuse(candidateValue, existingValue, ctx)
        case 'schema-record':
          return areSchemasEquivalentForReuse(candidateValue, existingValue, ctx, 'schema-record')
        default:
          return areSchemasEquivalentForReuse(candidateValue, existingValue, ctx, 'data')
      }
    },
  )
}

function areObjectsEquivalentForReuse(
  candidate: Record<string, unknown>,
  existing: Record<string, unknown>,
  areValuesEquivalent: (key: string, candidateValue: unknown, existingValue: unknown) => boolean,
): boolean {
  const candidateKeys = definedKeysOf(candidate)

  return (
    isDeepEqual(candidateKeys, definedKeysOf(existing)) &&
    candidateKeys.every((key) => areValuesEquivalent(key, candidate[key], existing[key]))
  )
}

function areRefValuesEquivalentForReuse(
  candidate: unknown,
  existing: unknown,
  ctx: ReuseComparisonContext,
): boolean {
  if (typeof candidate === 'string' && typeof existing === 'string') {
    return areSchemaRefsEquivalentForReuse(candidate, existing, ctx)
  }

  return areSchemasEquivalentForReuse(candidate, existing, ctx, 'data')
}

/**
 * `discriminator.mapping`/`defaultMapping` values can be refs, which are rewritten during hoisting like `$ref`,
 * so they must be compared by their targets rather than by their (prefix-dependent) strings.
 * Values that are not refs (bare schema names) still compare by string equality.
 */
function areDiscriminatorsEquivalentForReuse(
  candidate: unknown,
  existing: unknown,
  ctx: ReuseComparisonContext,
): boolean {
  if (!isPlainObject(candidate) || !isPlainObject(existing)) {
    return areSchemasEquivalentForReuse(candidate, existing, ctx, 'data')
  }

  return areObjectsEquivalentForReuse(candidate, existing, (key, candidateValue, existingValue) => {
    if (key === 'mapping' && isPlainObject(candidateValue) && isPlainObject(existingValue)) {
      return areObjectsEquivalentForReuse(
        candidateValue,
        existingValue,
        (_, candidateRef, existingRef) =>
          areRefValuesEquivalentForReuse(candidateRef, existingRef, ctx),
      )
    }

    if (key === 'defaultMapping') {
      return areRefValuesEquivalentForReuse(candidateValue, existingValue, ctx)
    }

    return areSchemasEquivalentForReuse(candidateValue, existingValue, ctx, 'data')
  })
}

function parseRefName(ref: string, prefix: string): string | undefined {
  if (!ref.startsWith(prefix)) {
    return undefined
  }

  return ref.slice(prefix.length).split('/').map(decodeJsonPointerSegment).join('/')
}

function resolveNamedRef(
  ref: string,
  prefix: string,
  getNamed: (name: string) => unknown,
): { key: string; schema: JsonSchema } | undefined {
  const name = parseRefName(ref, prefix)

  if (name === undefined) {
    return undefined
  }

  const schema = getNamed(name) as JsonSchema | undefined

  return schema === undefined ? undefined : { key: prefix + name, schema }
}

function areSchemaRefsEquivalentForReuse(
  candidateRef: string,
  existingRef: string,
  ctx: ReuseComparisonContext,
): boolean {
  const getComponent = (name: string) => getOwn(ctx.componentsSchemas, name)
  const candidate =
    resolveNamedRef(candidateRef, DEFS_REF_PREFIX, (name) => ctx.defs.get(name)) ??
    resolveNamedRef(candidateRef, COMPONENTS_REF_PREFIX, getComponent)
  const existing = resolveNamedRef(existingRef, COMPONENTS_REF_PREFIX, getComponent)

  if (candidate === undefined || existing === undefined) {
    ctx.unresolved = true
    return !candidate && !existing && candidateRef === existingRef
  }

  const pairedExisting = ctx.candidateToExistingKeys.get(candidate.key)

  if (pairedExisting !== existing.key) {
    if (pairedExisting !== undefined || ctx.pairedExistingKeys.has(existing.key)) {
      return false
    }

    ctx.candidateToExistingKeys.set(candidate.key, existing.key)
    ctx.pairedExistingKeys.add(existing.key)
  }

  return areSchemasEquivalentForReuse(candidate.schema, existing.schema, ctx)
}

function rewriteComponentSchemaRefs(
  schema: JsonSchema,
  renameMap: ReadonlyMap<string, string>,
): JsonSchema {
  return mapJsonSchemaRefs(schema, (ref) => {
    const refName = parseRefName(ref, DEFS_REF_PREFIX)

    if (refName === undefined) {
      return ref
    }

    const renamedName = renameMap.get(refName)

    if (renamedName === undefined) {
      return ref
    }

    return COMPONENTS_REF_PREFIX + renamedName
  })
}
