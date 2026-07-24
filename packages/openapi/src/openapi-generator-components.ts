// eslint-disable-next-line no-restricted-imports
import type { OpenAPIV3_1 } from '@hey-api/spec-types'
import type { JsonSchema } from '@orpc/json-schema'
import type { Value } from '@orpc/shared'
import type { OpenAPIDocument } from './types'
import {
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  ensureJsonSchemaObject,
  mapJsonSchemaRefs,
  visitJsonSchemaRefs,
} from '@orpc/json-schema'
import { isDeepEqual, value } from '@orpc/shared'

/**
 * Collects reusable schemas into `doc.components.schemas`.
 *
 * Equivalent schemas (including recursive ones) reuse a single component,
 * and different schemas competing for the same name get numbered postfixes.
 */
export class OpenAPIComponentRegistry {
  constructor(
    private readonly doc: OpenAPIDocument,
    private readonly shouldHoistDef: Value<boolean, [defName: string, defSchema: JsonSchema]> | undefined,
  ) {}

  /**
   * Registers `schema` as a component under `preferredName` (or an equivalent/postfixed name)
   * and returns a `$ref` to it. When hoisting is declined via `shouldHoistDef`, the schema is
   * returned in its local `$defs` form instead.
   */
  register(preferredName: string, schema: Exclude<JsonSchema, boolean>): JsonSchema {
    const { $defs, ...body } = schema

    // the schema can carry its own local $defs, keep the registered name unique among them
    let defName = preferredName
    if ($defs) {
      for (let i = 2; defName in $defs; i++) {
        defName = `${preferredName}${i}`
      }
    }

    return this.hoistDefs({
      $defs: { ...$defs, [defName]: body },
      $ref: `#/$defs/${encodeJsonPointerSegment(defName)}`,
    })
  }

  /**
   * Moves a schema's root-level `$defs` into `doc.components.schemas` and rewrites
   * its refs accordingly. Defs declined by `shouldHoistDef` stay local unless a
   * hoisted def references them.
   */
  hoistDefs(schema: JsonSchema): JsonSchema {
    if (typeof schema !== 'object' || !schema.$defs) {
      return schema
    }

    const { $defs, ...rest } = schema
    const localDefs: Record<string, Exclude<JsonSchema, boolean>> = {}
    const hoistedDefs: Record<string, Exclude<JsonSchema, boolean>> = {}

    for (const defName of Object.keys($defs)) {
      const defSchema = $defs[defName]

      if (defSchema === undefined) {
        continue
      }

      const normalized = ensureJsonSchemaObject(defSchema)

      if (value(this.shouldHoistDef, defName, normalized) !== false) {
        hoistedDefs[defName] = normalized
      }
      else {
        localDefs[defName] = normalized
      }
    }

    hoistReferencedLocalDefs(hoistedDefs, localDefs)

    if (Object.keys(hoistedDefs).length === 0) {
      return schema
    }

    this.doc.components ??= {}
    this.doc.components.schemas ??= {}

    const componentsSchemas = this.doc.components.schemas
    const identityRenameMap = Object.fromEntries(
      Object.keys(hoistedDefs).map(defName => [defName, defName]),
    ) as Record<string, string>
    const renameMap: Record<string, string> = {}
    const pendingSchemas: { cleanSchema: Exclude<JsonSchema, boolean>, componentName: string }[] = []

    for (const defName of Object.keys(hoistedDefs)) {
      const cleanSchema = hoistedDefs[defName]!
      const candidateSchemas = Object.fromEntries(
        Object.keys(hoistedDefs).map(currentDefName => [
          currentDefName,
          rewriteComponentSchemaRefs(
            withReferencedLocalDefs(hoistedDefs[currentDefName]!, localDefs),
            {
              ...identityRenameMap,
              ...renameMap,
            },
          ),
        ]),
      ) as Record<string, JsonSchema>
      const prelimSchema = candidateSchemas[defName]!

      const [componentName, reuseExisting] = resolveComponentName(
        componentsSchemas,
        new Set(Object.values(renameMap)),
        defName,
        prelimSchema,
        candidateSchemas,
      )

      renameMap[defName] = componentName

      if (!reuseExisting) {
        pendingSchemas.push({ cleanSchema, componentName })
      }
    }

    for (const { cleanSchema, componentName } of pendingSchemas) {
      componentsSchemas[componentName] = rewriteComponentSchemaRefs(
        withReferencedLocalDefs(cleanSchema, localDefs),
        renameMap,
      ) as OpenAPIV3_1.SchemaObject
    }

    return rewriteComponentSchemaRefs(withReferencedLocalDefs(rest, localDefs), renameMap)
  }

  toOpenAPISchema(schema: JsonSchema): OpenAPIV3_1.SchemaObject {
    return ensureJsonSchemaObject(this.hoistDefs(schema)) as OpenAPIV3_1.SchemaObject
  }
}

function visitLocalDefRefs(schema: JsonSchema, onRef: (defName: string) => void): void {
  visitJsonSchemaRefs(schema, (ref) => {
    const refName = parseLocalDefRefName(ref)

    if (refName !== undefined) {
      onRef(refName)
    }
  })
}

function hoistReferencedLocalDefs(
  hoistedDefs: Record<string, Exclude<JsonSchema, boolean>>,
  localDefs: Record<string, Exclude<JsonSchema, boolean>>,
): void {
  const queue = Object.values(hoistedDefs)

  while (queue.length > 0) {
    const current = queue.shift()!

    visitLocalDefRefs(current, (refName) => {
      const referenced = localDefs[refName]

      if (referenced === undefined) {
        return
      }

      hoistedDefs[refName] = referenced
      delete localDefs[refName]
      queue.push(referenced)
    })
  }
}

function withReferencedLocalDefs(
  schema: Exclude<JsonSchema, boolean>,
  localDefs: Record<string, Exclude<JsonSchema, boolean>>,
): Exclude<JsonSchema, boolean> {
  const referencedLocalDefs = collectReferencedLocalDefNames(schema, localDefs)

  if (referencedLocalDefs.length === 0) {
    return schema
  }

  const mergedDefs: Record<string, Exclude<JsonSchema, boolean>> = {
    ...(schema.$defs as Record<string, Exclude<JsonSchema, boolean>> | undefined),
  }

  for (const defName of referencedLocalDefs) {
    mergedDefs[defName] = localDefs[defName]!
  }

  return {
    ...schema,
    $defs: mergedDefs,
  }
}

function collectReferencedLocalDefNames(
  schema: JsonSchema,
  localDefs: Record<string, Exclude<JsonSchema, boolean>>,
): string[] {
  if (Object.keys(localDefs).length === 0) {
    return []
  }

  const referenced = new Set<string>()
  const queue: JsonSchema[] = [schema]

  while (queue.length > 0) {
    const current = queue.shift()!

    visitLocalDefRefs(current, (refName) => {
      if (localDefs[refName] === undefined || referenced.has(refName)) {
        return
      }

      referenced.add(refName)
      queue.push(localDefs[refName]!)
    })
  }

  return [...referenced]
}

/**
 * Walks the `name`, `name2`, `name3`, ... family until it finds an equivalent existing
 * component to reuse or a free slot to fill. Equal schemas under unrelated names are
 * never merged: a different name signals a different purpose.
 */
function resolveComponentName(
  componentsSchemas: Record<string, any>,
  claimedNames: Set<string>,
  defName: string,
  schema: JsonSchema,
  candidateSchemas: Record<string, JsonSchema>,
): [componentName: string, reuseExisting: boolean] {
  for (let i = 1; ; i++) {
    const componentName = i === 1 ? defName : `${defName}${i}`
    const existingSchema = componentsSchemas[componentName]

    if (existingSchema === undefined) {
      // a sibling def can claim a slot before its schema is written, keep probing past it
      if (claimedNames.has(componentName)) {
        continue
      }

      return [componentName, false]
    }

    if (areSchemasEquivalentForReuse(
      schema,
      existingSchema,
      schema,
      existingSchema,
      candidateSchemas,
      componentsSchemas,
      new Map([[defName, componentName]]),
      new Map([[componentName, defName]]),
    )) {
      return [componentName, true]
    }
  }
}

function definedKeysOf(object: Record<string, unknown>): string[] {
  // `undefined`-valued keys (e.g. `default: undefined`) are stripped during serialization,
  // so they must not affect equivalence against components from serialized documents
  return Object.keys(object).filter(key => object[key] !== undefined).sort()
}

function areSchemasEquivalentForReuse(
  candidate: unknown,
  existing: unknown,
  candidateRootSchema: JsonSchema,
  existingRootSchema: JsonSchema,
  candidateSchemas: Record<string, JsonSchema>,
  existingSchemas: Record<string, any>,
  candidateToExistingComponentNames: Map<string, string>,
  existingToCandidateComponentNames: Map<string, string>,
  visited = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (candidate === existing) {
    return true
  }

  if (typeof candidate !== typeof existing) {
    return false
  }

  if (candidate === null || existing === null) {
    return candidate === existing
  }

  if (typeof candidate !== 'object' || typeof existing !== 'object') {
    return isDeepEqual(candidate, existing)
  }

  const seenExisting = visited.get(candidate)

  if (seenExisting?.has(existing)) {
    return true
  }

  if (seenExisting) {
    seenExisting.add(existing)
  }
  else {
    visited.set(candidate, new WeakSet([existing]))
  }

  if (Array.isArray(candidate) || Array.isArray(existing)) {
    if (!Array.isArray(candidate) || !Array.isArray(existing) || candidate.length !== existing.length) {
      return false
    }

    return candidate.every((item, index) => areSchemasEquivalentForReuse(
      item,
      existing[index],
      candidateRootSchema,
      existingRootSchema,
      candidateSchemas,
      existingSchemas,
      candidateToExistingComponentNames,
      existingToCandidateComponentNames,
      visited,
    ))
  }

  const candidateObject = candidate as Record<string, unknown>
  const existingObject = existing as Record<string, unknown>
  const candidateKeys = definedKeysOf(candidateObject)
  const existingKeys = definedKeysOf(existingObject)

  if (!isDeepEqual(candidateKeys, existingKeys)) {
    return false
  }

  return candidateKeys.every((key) => {
    const candidateValue = candidateObject[key]
    const existingValue = existingObject[key]

    if (key === '$ref' && typeof candidateValue === 'string' && typeof existingValue === 'string') {
      return areSchemaRefsEquivalentForReuse(
        candidateValue,
        existingValue,
        candidateRootSchema,
        existingRootSchema,
        candidateSchemas,
        existingSchemas,
        candidateToExistingComponentNames,
        existingToCandidateComponentNames,
        visited,
      )
    }

    return areSchemasEquivalentForReuse(
      candidateValue,
      existingValue,
      candidateRootSchema,
      existingRootSchema,
      candidateSchemas,
      existingSchemas,
      candidateToExistingComponentNames,
      existingToCandidateComponentNames,
      visited,
    )
  })
}

function parseComponentRefName(ref: string): string | undefined {
  if (!ref.startsWith('#/components/schemas/')) {
    return undefined
  }

  return ref
    .slice('#/components/schemas/'.length)
    .split('/')
    .map(decodeJsonPointerSegment)
    .join('/')
}

function resolveSchemaComparisonRef(
  ref: string,
  rootSchema: JsonSchema,
  componentsSchemas: Record<string, any>,
): { schema: JsonSchema, rootSchema: JsonSchema } | undefined {
  const localDefName = parseLocalDefRefName(ref)

  if (localDefName !== undefined && typeof rootSchema === 'object' && rootSchema !== null) {
    const localDef = rootSchema.$defs?.[localDefName]

    if (localDef !== undefined) {
      return {
        schema: localDef,
        rootSchema,
      }
    }
  }

  const componentName = parseComponentRefName(ref)

  if (componentName !== undefined) {
    const componentSchema = componentsSchemas[componentName]

    if (componentSchema !== undefined) {
      return {
        schema: componentSchema,
        rootSchema: componentSchema,
      }
    }
  }

  return undefined
}

function areSchemaRefsEquivalentForReuse(
  candidateRef: string,
  existingRef: string,
  candidateRootSchema: JsonSchema,
  existingRootSchema: JsonSchema,
  candidateSchemas: Record<string, JsonSchema>,
  existingSchemas: Record<string, any>,
  candidateToExistingComponentNames: Map<string, string>,
  existingToCandidateComponentNames: Map<string, string>,
  visited: WeakMap<object, WeakSet<object>>,
): boolean {
  const candidateComponentName = parseComponentRefName(candidateRef)
  const existingComponentName = parseComponentRefName(existingRef)

  if ((candidateComponentName === undefined) !== (existingComponentName === undefined)) {
    return false
  }

  if (candidateComponentName !== undefined && existingComponentName !== undefined) {
    const mappedExisting = candidateToExistingComponentNames.get(candidateComponentName)

    if (mappedExisting !== undefined && mappedExisting !== existingComponentName) {
      return false
    }

    const mappedCandidate = existingToCandidateComponentNames.get(existingComponentName)

    if (mappedCandidate !== undefined && mappedCandidate !== candidateComponentName) {
      return false
    }

    candidateToExistingComponentNames.set(candidateComponentName, existingComponentName)
    existingToCandidateComponentNames.set(existingComponentName, candidateComponentName)
  }

  const resolvedCandidate = resolveSchemaComparisonRef(candidateRef, candidateRootSchema, candidateSchemas)
  const resolvedExisting = resolveSchemaComparisonRef(existingRef, existingRootSchema, existingSchemas)

  if (resolvedCandidate === undefined || resolvedExisting === undefined) {
    return candidateRef === existingRef
  }

  return areSchemasEquivalentForReuse(
    resolvedCandidate.schema,
    resolvedExisting.schema,
    resolvedCandidate.rootSchema,
    resolvedExisting.rootSchema,
    candidateSchemas,
    existingSchemas,
    candidateToExistingComponentNames,
    existingToCandidateComponentNames,
    visited,
  )
}

function parseLocalDefRefName(ref: string): string | undefined {
  if (!ref.startsWith('#/$defs/')) {
    return undefined
  }

  return ref
    .slice('#/$defs/'.length)
    .split('/')
    .map(decodeJsonPointerSegment)
    .join('/')
}

function rewriteComponentSchemaRefs(schema: JsonSchema, renameMap: Record<string, string>): JsonSchema {
  return mapJsonSchemaRefs(schema, (ref) => {
    const refName = parseLocalDefRefName(ref)

    if (refName === undefined) {
      return ref
    }

    const renamedName = renameMap[refName]

    if (renamedName === undefined) {
      return ref
    }

    return `#/components/schemas/${encodeJsonPointerSegment(renamedName)}`
  })
}
