import type { JsonSchema } from './types'
import { get, getOwn, isPlainObject, toArray, tryOrUndefined } from '@orpc/shared'
import { decodeJsonPointerSegment } from './ref-utils'
import { JsonSchemaXNativeType } from './types'

/**
 * How well a value matches a schema, used to pick the best union branch.
 */
const UNSATISFIED = 0
/**
 * Every keyword matches except some object keys or array items no schema describes.
 * JSON Schema allows those, and validators usually strip or ignore them, but a branch
 * that describes every key is still a better match.
 */
const LOOSELY_SATISFIED = 1
/** Every keyword matches. */
const SATISFIED = 2

type Satisfaction = typeof UNSATISFIED | typeof LOOSELY_SATISFIED | typeof SATISFIED

function minSatisfaction(a: Satisfaction, b: Satisfaction): Satisfaction {
  return a < b ? a : b
}

export class JsonSchemaCoercer {
  coerce([schema, optional]: [schema: JsonSchema, optional: boolean], value: unknown): unknown {
    if (optional && value === undefined) {
      return value
    }

    const [, coerced] = this.coerceInternal(schema, schema, value)
    return coerced
  }

  private coerceInternal(
    rootSchema: JsonSchema,
    schema: JsonSchema,
    value: unknown,
    /**
     * Schemas already applied to this exact value, used to stop `$ref` cycles.
     * Only shared between keywords that re-apply a schema to the same value, never with nested values.
     */
    appliedRefs?: Set<JsonSchema>,
  ): [satisfied: Satisfaction, coerced: unknown] {
    if (typeof schema === 'boolean') {
      return [schema ? SATISFIED : UNSATISFIED, value]
    }

    if (Array.isArray(schema.type)) {
      return this.coerceInternal(
        rootSchema,
        { anyOf: schema.type.map(type => ({ ...schema, type })) },
        value,
        appliedRefs,
      )
    }

    let coerced = value
    let satisfied: Satisfaction = SATISFIED

    if (typeof schema.$ref === 'string') {
      const resolved
        = schema.$ref.startsWith('#/')
          ? get(rootSchema, schema.$ref.slice('#/'.length).split('/').map(decodeJsonPointerSegment)) as JsonSchema | undefined
          : schema.$ref === '#'
            ? rootSchema
            : undefined

      if (resolved !== undefined && !appliedRefs?.has(resolved)) {
        appliedRefs ??= new Set()
        appliedRefs.add(resolved)

        const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, resolved, coerced, appliedRefs)

        appliedRefs.delete(resolved)

        coerced = subCoerced
        satisfied = minSatisfaction(satisfied, subSatisfied)
      }
    }

    const enumValues = schema.const !== undefined ? [schema.const] : schema.enum
    if (enumValues !== undefined && !enumValues.includes(coerced)) {
      if (typeof coerced === 'string') {
        const numberValue = stringToNumber(coerced)

        if (enumValues.includes(numberValue)) {
          coerced = numberValue
        }
        else {
          const booleanValue = stringToBoolean(coerced)

          if (enumValues.includes(booleanValue)) {
            coerced = booleanValue
          }
          else {
            satisfied = UNSATISFIED
          }
        }
      }
      else {
        satisfied = UNSATISFIED
      }
    }

    if (schema.type) {
      switch (schema.type) {
        case 'null': {
          if (coerced !== null) {
            satisfied = UNSATISFIED
          }

          break
        }
        case 'string': {
          if (typeof coerced !== 'string') {
            satisfied = UNSATISFIED
          }

          break
        }
        case 'number': {
          if (typeof coerced === 'string') {
            coerced = stringToNumber(coerced)
          }

          if (typeof coerced !== 'number') {
            satisfied = UNSATISFIED
          }

          break
        }
        case 'integer': {
          if (typeof coerced === 'string') {
            coerced = stringToInteger(coerced)
          }

          if (typeof coerced !== 'number' || !Number.isInteger(coerced)) {
            satisfied = UNSATISFIED
          }

          break
        }
        case 'boolean': {
          if (typeof coerced === 'string') {
            coerced = stringToBoolean(coerced)
          }

          if (typeof coerced !== 'boolean') {
            satisfied = UNSATISFIED
          }

          break
        }
        case 'array': {
          if (Array.isArray(coerced)) {
            const prefixItemSchemas: readonly JsonSchema[] = 'prefixItems' in schema
              ? toArray(schema.prefixItems)
              : Array.isArray(schema.items)
                ? schema.items
                : []

            const itemSchema: JsonSchema | undefined = Array.isArray(schema.items)
              ? schema.additionalItems as JsonSchema | undefined
              : schema.items as JsonSchema | undefined

            let shouldUseCoercedItems = false

            const coercedItems = coerced.map((item, i) => {
              const subSchema = prefixItemSchemas[i] ?? itemSchema
              if (subSchema === undefined) {
                satisfied = minSatisfaction(satisfied, LOOSELY_SATISFIED)
                return item
              }

              const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, item)

              satisfied = minSatisfaction(satisfied, subSatisfied)

              if (subCoerced !== item) {
                shouldUseCoercedItems = true
              }

              return subCoerced
            })

            if (coercedItems.length < prefixItemSchemas.length) {
              satisfied = UNSATISFIED
            }

            if (shouldUseCoercedItems) {
              coerced = coercedItems
            }
          }
          else {
            satisfied = UNSATISFIED
          }
          break
        }
        case 'object': {
          if (Array.isArray(coerced)) {
            coerced = { ...coerced }
          }

          if (isPlainObject(coerced)) {
            let shouldUseCoercedItems = false
            // copy here so special keys like `__proto__` are kept as own properties
            const coercedItems = { ...coerced }

            const patternProperties = Object.entries(schema.patternProperties ?? {})
              .flatMap(([key, value]) => {
                // an invalid pattern is a schema mistake, it should not break coercion of the other keys
                const pattern = tryOrUndefined(() => new RegExp(key))
                return pattern ? [[pattern, value] as const] : []
              })

            const propertySchemas: Record<string, JsonSchema> = schema.properties ?? {}

            for (const key of Object.keys(coerced)) {
              const value = coerced[key]

              const subSchema = getOwn(propertySchemas, key)
                ?? patternProperties.find(([pattern]) => pattern.test(key))?.[1]
                ?? schema.additionalProperties

              if (value !== undefined || schema.required?.includes(key)) {
                if (subSchema === undefined) {
                  satisfied = minSatisfaction(satisfied, LOOSELY_SATISFIED)
                }
                else {
                  const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, value)
                  coercedItems[key] = subCoerced

                  satisfied = minSatisfaction(satisfied, subSatisfied)

                  if (subCoerced !== value) {
                    shouldUseCoercedItems = true
                  }
                }
              }
            }

            if (schema.required?.some(key => !Object.hasOwn(coercedItems, key))) {
              satisfied = UNSATISFIED
            }

            if (shouldUseCoercedItems) {
              coerced = coercedItems
            }
          }
          else {
            satisfied = UNSATISFIED
          }

          break
        }
      }
    }

    if ('x-native-type' in schema && typeof schema['x-native-type'] === 'string') {
      switch (schema['x-native-type']) {
        case JsonSchemaXNativeType.Date: {
          if (typeof coerced === 'string') {
            coerced = stringToDate(coerced)
          }

          if (!(coerced instanceof Date)) {
            satisfied = UNSATISFIED
          }

          break
        }
        case JsonSchemaXNativeType.BigInt: {
          switch (typeof coerced) {
            case 'string':
              coerced = stringToBigInt(coerced)
              break
            case 'number':
              coerced = numberToBigInt(coerced)
              break
          }

          if (typeof coerced !== 'bigint') {
            satisfied = UNSATISFIED
          }

          break
        }
        case JsonSchemaXNativeType.RegExp: {
          if (typeof coerced === 'string') {
            coerced = stringToRegExp(coerced)
          }

          if (!(coerced instanceof RegExp)) {
            satisfied = UNSATISFIED
          }

          break
        }
        case JsonSchemaXNativeType.Url: {
          if (typeof coerced === 'string') {
            coerced = stringToURL(coerced)
          }

          if (!(coerced instanceof URL)) {
            satisfied = UNSATISFIED
          }

          break
        }
        case JsonSchemaXNativeType.Set: {
          if (Array.isArray(coerced)) {
            coerced = arrayToSet(coerced)
          }

          if (!(coerced instanceof Set)) {
            satisfied = UNSATISFIED
          }

          break
        }
        case JsonSchemaXNativeType.Map: {
          if (Array.isArray(coerced)) {
            coerced = arrayToMap(coerced)
          }

          if (!(coerced instanceof Map)) {
            satisfied = UNSATISFIED
          }

          break
        }
      }
    }

    if (schema.allOf) {
      for (const subSchema of schema.allOf) {
        const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, coerced, appliedRefs)

        coerced = subCoerced
        satisfied = minSatisfaction(satisfied, subSatisfied)
      }
    }

    for (const key of ['anyOf', 'oneOf'] as const) {
      if (schema[key]) {
        /**
         * The best branch is the first one that accepts the value untouched,
         * then the most satisfied branch that accepts it after a conversion.
         */
        let best: { satisfied: Satisfaction, value: unknown } | undefined

        for (const subSchema of schema[key]) {
          const [subSatisfied, subCoerced] = this.coerceInternal(rootSchema, subSchema, coerced, appliedRefs)

          if (subSatisfied === UNSATISFIED) {
            continue
          }

          if (subCoerced === coerced) {
            best = { satisfied: subSatisfied, value: subCoerced }
            break
          }

          if (!best || subSatisfied > best.satisfied) {
            best = { satisfied: subSatisfied, value: subCoerced }
          }
        }

        // a matching branch never repairs a sibling keyword that already failed, so satisfaction only decreases
        if (best) {
          coerced = best.value
          satisfied = minSatisfaction(satisfied, best.satisfied)
        }
        else {
          satisfied = UNSATISFIED
        }
      }
    }

    if (typeof schema.not !== 'undefined') {
      const [notSatisfied] = this.coerceInternal(rootSchema, schema.not, coerced, appliedRefs)

      if (notSatisfied !== UNSATISFIED) {
        satisfied = UNSATISFIED
      }
    }

    return [satisfied, coerced]
  }
}

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
function stringToNumber(value: string): number | string {
  if (!NUMBER_PATTERN.test(value)) {
    return value
  }

  const num = Number(value)

  // beyond the safe range digits get lost, `'12345678901234567890'` would become `12345678901234567168`
  if (num < Number.MIN_SAFE_INTEGER || num > Number.MAX_SAFE_INTEGER) {
    return value
  }

  return num
}

const INTEGER_PATTERN = /^-?(?:0|[1-9]\d*)$/
function stringToInteger(value: string): number | string {
  if (!INTEGER_PATTERN.test(value)) {
    return value
  }

  const num = Number(value)

  if (!Number.isSafeInteger(num)) {
    return value
  }

  return num
}

function stringToBigInt(value: string): bigint | string {
  if (!INTEGER_PATTERN.test(value)) {
    return value
  }

  return BigInt(value)
}

function numberToBigInt(value: number): bigint | number {
  if (!Number.isInteger(value)) {
    return value
  }

  return BigInt(value)
}

function stringToBoolean(value: string): boolean | string {
  const lower = value.toLowerCase()

  if (lower === 'false' || lower === 'off') {
    return false
  }

  if (lower === 'true' || lower === 'on') {
    return true
  }

  return value
}

const DATE_TIME_PATTERN = /^[+-]?\d{4,6}-\d{1,2}-\d{1,2}(?:[T ].*)?$/
function stringToDate(value: string): Date | string {
  if (!DATE_TIME_PATTERN.test(value)) {
    return value
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date
}

const REGEXP_PATTERN = /^\/([\s\S]*)\/([a-z]*)$/
function stringToRegExp(value: string): RegExp | string {
  const match = value.match(REGEXP_PATTERN)

  if (match) {
    const [, pattern, flags] = match
    return tryOrUndefined(() => new RegExp(pattern!, flags)) ?? value
  }

  return value
}

function stringToURL(value: string): URL | string {
  return tryOrUndefined(() => new URL(value)) ?? value
}

function arrayToSet(value: unknown[]): Set<unknown> | unknown[] {
  const set = new Set(value)

  if (set.size !== value.length) {
    return value
  }

  return set
}

function arrayToMap(value: unknown[]): Map<unknown, unknown> | unknown[] {
  if (value.some(item => !Array.isArray(item) || item.length !== 2)) {
    return value
  }

  const result = new Map(value as [unknown, unknown][])

  if (result.size !== value.length) {
    return value
  }

  return result
}
